import { describe, expect, it } from 'vitest'
import { AudioManager, type AudioStatus } from './AudioManager'

class FakeAudioParam {
  value = 0
  readonly scheduled: number[] = []

  setValueAtTime(value: number): this {
    this.value = value
    this.scheduled.push(value)
    return this
  }

  exponentialRampToValueAtTime(value: number): this {
    this.value = value
    this.scheduled.push(value)
    return this
  }

  setTargetAtTime(value: number): this {
    this.value = value
    this.scheduled.push(value)
    return this
  }

  cancelScheduledValues(): this {
    return this
  }
}

class FakeAudioNode {
  readonly connections: FakeAudioNode[] = []
  disconnected = false

  connect(destination: FakeAudioNode): FakeAudioNode {
    this.connections.push(destination)
    return destination
  }

  disconnect(): void {
    this.disconnected = true
  }
}

class FakeGainNode extends FakeAudioNode {
  readonly gain = new FakeAudioParam()
}

class FakeCompressorNode extends FakeAudioNode {
  readonly threshold = new FakeAudioParam()
  readonly knee = new FakeAudioParam()
  readonly ratio = new FakeAudioParam()
  readonly attack = new FakeAudioParam()
  readonly release = new FakeAudioParam()
}

class FakeOscillatorNode extends FakeAudioNode {
  readonly frequency = new FakeAudioParam()
  readonly detune = new FakeAudioParam()
  type: OscillatorType = 'sine'
  starts = 0
  stops = 0

  addEventListener(): void {}

  start(): void {
    this.starts += 1
  }

  stop(): void {
    this.stops += 1
  }
}

class FakeFilterNode extends FakeAudioNode {
  readonly frequency = new FakeAudioParam()
  readonly Q = new FakeAudioParam()
  type: BiquadFilterType = 'lowpass'
}

type ResumeMode = 'run' | 'stay-suspended' | 'reject'

class FakeAudioContext {
  state: AudioContextState = 'suspended'
  currentTime = 1
  resumeMode: ResumeMode
  resumeCalls = 0
  readonly destination = new FakeAudioNode()
  readonly gains: FakeGainNode[] = []
  readonly compressors: FakeCompressorNode[] = []
  readonly oscillators: FakeOscillatorNode[] = []
  readonly filters: FakeFilterNode[] = []
  private readonly stateListeners = new Set<() => void>()

  constructor(resumeMode: ResumeMode = 'run') {
    this.resumeMode = resumeMode
  }

  createGain(): GainNode {
    const node = new FakeGainNode()
    this.gains.push(node)
    return node as unknown as GainNode
  }

  createDynamicsCompressor(): DynamicsCompressorNode {
    const node = new FakeCompressorNode()
    this.compressors.push(node)
    return node as unknown as DynamicsCompressorNode
  }

  createOscillator(): OscillatorNode {
    const node = new FakeOscillatorNode()
    this.oscillators.push(node)
    return node as unknown as OscillatorNode
  }

  createBiquadFilter(): BiquadFilterNode {
    const node = new FakeFilterNode()
    this.filters.push(node)
    return node as unknown as BiquadFilterNode
  }

  addEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    if (type === 'statechange' && typeof listener === 'function') this.stateListeners.add(listener as () => void)
  }

  removeEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    if (type === 'statechange' && typeof listener === 'function') this.stateListeners.delete(listener as () => void)
  }

  async resume(): Promise<void> {
    this.resumeCalls += 1
    if (this.resumeMode === 'reject') throw new DOMException('Playback blocked', 'NotAllowedError')
    if (this.resumeMode === 'run') {
      this.state = 'running'
      this.emitStateChange()
    }
  }

  async close(): Promise<void> {
    this.state = 'closed'
    this.emitStateChange()
  }

  suspendForTest(): void {
    this.state = 'suspended'
    this.emitStateChange()
  }

  private emitStateChange(): void {
    for (const listener of this.stateListeners) listener()
  }
}

const createManager = (context: FakeAudioContext): AudioManager =>
  new AudioManager(() => context as unknown as AudioContext)

describe('AudioManager browser unlock', () => {
  it('only becomes ready after the context is actually running and plays a confirmation tone', async () => {
    const context = new FakeAudioContext('run')
    const manager = createManager(context)
    const statuses: AudioStatus[] = []
    manager.subscribeStatus((status) => statuses.push(status))

    await expect(manager.enableFromUserGesture()).resolves.toBe(true)

    expect(context.resumeCalls).toBe(1)
    expect(manager.getStatus()).toBe('ready')
    expect(statuses).toContain('unlocking')
    expect(context.compressors).toHaveLength(1)
    expect(context.gains[0]?.connections[0]).toBe(context.compressors[0])
    expect(context.compressors[0]?.connections[0]).toBe(context.destination)
    expect(context.oscillators).toHaveLength(1)
    expect(context.oscillators[0]?.frequency.scheduled).toEqual([660, 880])
    expect(context.oscillators[0]?.starts).toBe(1)
    expect(context.gains[0]?.gain.value).toBeCloseTo(0.36)
  })

  it('reports blocked when resume rejects instead of pretending audio is ready', async () => {
    const context = new FakeAudioContext('reject')
    const manager = createManager(context)

    await expect(manager.enableFromUserGesture()).resolves.toBe(false)

    expect(manager.getStatus()).toBe('blocked')
    expect(context.oscillators).toHaveLength(0)
  })

  it('requires running state even when resume resolves', async () => {
    const context = new FakeAudioContext('stay-suspended')
    const manager = createManager(context)

    await expect(manager.enableFromUserGesture()).resolves.toBe(false)

    expect(manager.getStatus()).toBe('blocked')
    expect(context.oscillators).toHaveLength(0)
  })

  it('recovers a blocked context on a later user interaction', async () => {
    const context = new FakeAudioContext('reject')
    const manager = createManager(context)
    await manager.enableFromUserGesture()
    context.resumeMode = 'run'

    await expect(manager.resumeFromUserGesture()).resolves.toBe(true)

    expect(context.resumeCalls).toBe(2)
    expect(manager.getStatus()).toBe('ready')
    expect(context.oscillators).toHaveLength(1)
  })

  it('reflects a context suspended by the browser and ignores retries while disabled', async () => {
    const context = new FakeAudioContext('run')
    const manager = createManager(context)
    await manager.enableFromUserGesture()

    context.suspendForTest()
    expect(manager.getStatus()).toBe('suspended')

    manager.setEnabled(false)
    await expect(manager.resumeFromUserGesture()).resolves.toBe(false)
    expect(manager.getStatus()).toBe('disabled')
  })

  it('renders the fist burst in a laptop-audible mid-frequency range', async () => {
    const context = new FakeAudioContext('run')
    const manager = createManager(context)
    await manager.enableFromUserGesture()

    manager.handle({
      type: 'FIST',
      hand: 'left',
      pose: {
        position: { x: 0.5, y: 0.5, z: 0 },
        width: 0.12,
        rotation: 0,
        normal: { x: 0, y: 0, z: 1 },
        confidence: 1,
      },
      intensity: 1,
    })
    await Promise.resolve()

    const burstOscillators = context.oscillators.slice(-2)
    expect(burstOscillators[0]?.frequency.scheduled[0]).toBe(520)
    expect(burstOscillators[1]?.frequency.scheduled[0]).toBe(880)
    expect(context.gains.at(-1)?.gain.scheduled.some((value) => value >= 0.22)).toBe(true)
  })
})
