import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

const requestedUrl = process.env.DOCTORAR_URL ?? 'http://127.0.0.1:4173'
const target = new URL(requestedUrl)
target.searchParams.set('doctorar-smoke', '1')
const targetUrl = target.href
const screenshotPath = resolve(process.argv[2] ?? 'doctorar-browser-smoke.png')
const browserCandidates = [
  process.env.EDGE_PATH,
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
].filter(Boolean)
const browserPath = browserCandidates.find((candidate) => existsSync(candidate))

if (!browserPath) throw new Error('Microsoft Edge or Google Chrome was not found.')

const delay = (milliseconds) => new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds))

const waitForValue = async (read, timeoutMs, label) => {
  const startedAt = Date.now()
  let lastValue
  while (Date.now() - startedAt < timeoutMs) {
    lastValue = await read()
    if (lastValue) return lastValue
    await delay(150)
  }
  throw new Error(`Timed out waiting for ${label}. Last value: ${JSON.stringify(lastValue)}`)
}

class CdpSession {
  constructor(url) {
    this.socket = new WebSocket(url)
    this.nextId = 1
    this.pending = new Map()
    this.listeners = new Set()
  }

  async open() {
    if (this.socket.readyState === WebSocket.OPEN) return
    await new Promise((resolveOpen, rejectOpen) => {
      this.socket.addEventListener('open', resolveOpen, { once: true })
      this.socket.addEventListener('error', rejectOpen, { once: true })
    })
    const rejectPending = (reason) => {
      const error = reason instanceof Error ? reason : new Error(String(reason))
      for (const pending of this.pending.values()) pending.reject(error)
      this.pending.clear()
    }
    this.socket.addEventListener('close', () => rejectPending(new Error('Browser debugging connection closed.')))
    this.socket.addEventListener('error', () => rejectPending(new Error('Browser debugging connection failed.')))
    this.socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data))
      if (message.id) {
        const pending = this.pending.get(message.id)
        if (!pending) return
        this.pending.delete(message.id)
        if (message.error) pending.reject(new Error(message.error.message))
        else pending.resolve(message.result)
        return
      }
      for (const listener of this.listeners) listener(message)
    })
  }

  onEvent(listener) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  send(method, params = {}) {
    const id = this.nextId
    this.nextId += 1
    return new Promise((resolveSend, rejectSend) => {
      this.pending.set(id, { resolve: resolveSend, reject: rejectSend })
      this.socket.send(JSON.stringify({ id, method, params }))
    })
  }

  close() {
    this.socket.close()
  }
}

const profileDirectory = await mkdtemp(join(tmpdir(), 'doctorar-edge-'))
const remotePort = 9300 + Math.floor(Math.random() * 500)
const browserErrors = []
const browserProcess = spawn(browserPath, [
  '--headless=new',
  `--remote-debugging-port=${remotePort}`,
  `--user-data-dir=${profileDirectory}`,
  '--no-first-run',
  '--no-default-browser-check',
  '--use-fake-ui-for-media-stream',
  '--use-fake-device-for-media-stream',
  '--autoplay-policy=no-user-gesture-required',
  '--use-angle=swiftshader-webgl',
  '--enable-unsafe-swiftshader',
  '--window-size=1440,900',
  targetUrl,
], { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true })

browserProcess.stderr.setEncoding('utf8')
browserProcess.stderr.on('data', (chunk) => browserErrors.push(chunk))

let session
try {
  const targets = await waitForValue(async () => {
    try {
      const response = await fetch(`http://127.0.0.1:${remotePort}/json/list`)
      if (!response.ok) return null
      const values = await response.json()
      return values.length ? values : null
    } catch {
      return null
    }
  }, 12_000, 'browser debugging endpoint')

  const pageTarget = targets.find((target) => target.type === 'page') ?? targets[0]
  session = new CdpSession(pageTarget.webSocketDebuggerUrl)
  await session.open()

  const exceptions = []
  const consoleErrors = []
  const networkFailures = []
  session.onEvent((message) => {
    if (message.method === 'Runtime.exceptionThrown') {
      exceptions.push(message.params.exceptionDetails?.text ?? 'Runtime exception')
    }
    if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
      consoleErrors.push(message.params.args?.map((argument) => argument.value ?? argument.description).join(' ') ?? 'console.error')
    }
    if (message.method === 'Network.loadingFailed' && !message.params.canceled) {
      networkFailures.push(`${message.params.errorText}: ${message.params.blockedReason ?? message.params.type}`)
    }
    if (message.method === 'Network.responseReceived' && message.params.response.status >= 400) {
      networkFailures.push(`${message.params.response.status}: ${message.params.response.url}`)
    }
  })

  await Promise.all([
    session.send('Page.enable'),
    session.send('Runtime.enable'),
    session.send('Network.enable'),
  ])
  await session.send('Page.navigate', { url: targetUrl })

  const evaluate = async (expression) => {
    const result = await session.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    })
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text)
    return result.result.value
  }

  await waitForValue(
    () => evaluate('document.readyState === "complete" && Boolean(document.querySelector(".start-button"))'),
    10_000,
    'DoctorAR start screen',
  )

  const initial = await evaluate(`(() => ({
    title: document.title,
    hasBrand: Boolean(document.querySelector('.brand-lockup')),
    hasStartButton: Boolean(document.querySelector('.start-button')),
    effectDeferred: !document.querySelector('canvas.effect-layer')
  }))()`)

  await evaluate('document.querySelector(".start-button").click()')

  const ready = await waitForValue(async () => {
    const value = await evaluate(`(() => ({
      ready: document.querySelector('.system-status')?.classList.contains('is-ready') ?? false,
      error: document.querySelector('.error-card p')?.textContent ?? '',
      viteError: document.querySelector('vite-error-overlay')?.shadowRoot?.textContent ?? '',
      videoWidth: document.querySelector('video')?.videoWidth ?? 0,
      videoHeight: document.querySelector('video')?.videoHeight ?? 0,
      controls: Boolean(document.querySelector('.control-panel')),
      effectCanvas: Boolean(document.querySelector('canvas.effect-layer'))
    }))()`)
    if (value.error || value.viteError) throw new Error(value.error || value.viteError)
    return value.ready ? value : null
  }, 35_000, 'camera, MediaPipe model, and WebGL readiness')

  await evaluate(`(() => {
    const debugLabel = [...document.querySelectorAll('.toggle-row')].find((label) => label.textContent.includes('调试模式'))
    debugLabel?.click()
    document.querySelectorAll('.theme-grid button')[1]?.click()
  })()`)
  const v11EffectsRendered = await waitForValue(() => evaluate(`(() => {
    const rows = [...document.querySelectorAll('.debug-grid > div')]
    const read = (label) => rows.find((row) => row.querySelector('dt')?.textContent === label)?.querySelector('dd')?.textContent ?? ''
    const backend = read('视觉后端')
    const inferenceMs = Number.parseFloat(read('推理'))
    return backend === 'WORKER' && Number.isFinite(inferenceMs) && inferenceMs > 0
  })()`), 12_000, 'a completed Worker inference')
  await evaluate(`(() => {
    const bus = window.__DOCTORAR_GESTURE_BUS__
    if (!bus) throw new Error('Development gesture test bus is unavailable')
    const now = performance.now()
    bus.emit({ type: 'PINCH_START', hand: 'left', position: { x: 0.32, y: 0.56, z: 0 } })
    for (let index = 1; index <= 12; index += 1) {
      bus.emit({
        type: 'PINCH_MOVE',
        hand: 'left',
        position: { x: 0.32 + index * 0.022, y: 0.56 - Math.sin(index * 0.48) * 0.11, z: 0 },
      })
    }
    bus.emit({ type: 'TWO_HAND_RELEASE', center: { x: 0.5, y: 0.5, z: 0 }, velocity: 1.8, timestamp: now })
  })()`)
  await waitForValue(() => evaluate(`(() => {
    const rows = [...document.querySelectorAll('.debug-grid > div')]
    const readNumber = (label) => Number.parseFloat(rows.find((row) => row.querySelector('dt')?.textContent === label)?.querySelector('dd')?.textContent ?? '0')
    return readNumber('轨迹段') > 0 && readNumber('冲击波') > 0
  })()`), 3_000, 'V1.1 trail and shockwave rendering')

  const interactions = {
    ...await evaluate(`(() => ({
    debugPanel: Boolean(document.querySelector('.debug-panel')),
    activeTheme: document.querySelector('.theme-grid button.is-active')?.getAttribute('title') ?? '',
    visionBackend: [...document.querySelectorAll('.debug-grid > div')].find((row) => row.querySelector('dt')?.textContent === '视觉后端')?.querySelector('dd')?.textContent ?? '',
    trailSegments: Number.parseFloat([...document.querySelectorAll('.debug-grid > div')].find((row) => row.querySelector('dt')?.textContent === '轨迹段')?.querySelector('dd')?.textContent ?? '0'),
    shockwaves: Number.parseFloat([...document.querySelectorAll('.debug-grid > div')].find((row) => row.querySelector('dt')?.textContent === '冲击波')?.querySelector('dd')?.textContent ?? '0'),
    webglWidth: document.querySelector('canvas.effect-layer')?.width ?? 0,
    debugWidth: document.querySelector('canvas.debug-layer')?.width ?? 0,
    statusText: document.querySelector('.system-status span')?.textContent ?? ''
    }))()`),
    v11EffectsRendered,
  }

  const screenshot = await session.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
  await writeFile(screenshotPath, Buffer.from(screenshot.data, 'base64'))

  const result = {
    url: targetUrl,
    initial,
    ready,
    interactions,
    exceptions,
    consoleErrors,
    networkFailures,
    screenshot: screenshotPath,
  }
  console.log(JSON.stringify(result, null, 2))

  if (!initial.hasBrand || !initial.hasStartButton || !initial.effectDeferred) process.exitCode = 1
  if (!ready.controls || !ready.effectCanvas || ready.videoWidth <= 0 || ready.videoHeight <= 0) process.exitCode = 1
  if (!interactions.debugPanel || interactions.activeTheme !== '蓝色空间' || interactions.visionBackend !== 'WORKER' || !interactions.v11EffectsRendered || interactions.webglWidth <= 0) process.exitCode = 1
  if (exceptions.length || consoleErrors.length || networkFailures.length) process.exitCode = 1

  await session.send('Browser.close').catch(() => undefined)
} catch (error) {
  process.exitCode = 1
  console.error(error instanceof Error ? error.stack : error)
} finally {
  session?.close()
  if (!browserProcess.killed) browserProcess.kill()
  if (profileDirectory.startsWith(join(tmpdir(), 'doctorar-edge-'))) {
    await rm(profileDirectory, { recursive: true, force: true }).catch(() => undefined)
  }
  const stderr = browserErrors.join('').trim()
  if (stderr && process.exitCode) console.error(stderr.slice(-4000))
}
