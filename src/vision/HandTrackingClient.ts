import type { HandFrame } from '../types/hand'
import type { VisionWorkerRequest, VisionWorkerResponse } from '../types/visionWorker'

export interface HandTrackingResult {
  frame: HandFrame
  roundTripMs: number
}

export interface HandTrackingFrameOptions {
  timestamp: number
  videoWidth: number
  videoHeight: number
  smoothing: number
  sensitivity: number
}

interface HandTrackingClientCallbacks {
  onResult: (result: HandTrackingResult) => void
  onError: (message: string) => void
}

const INIT_TIMEOUT_MS = 15_000
const DISPOSE_TIMEOUT_MS = 1_000

const abortError = (): DOMException => new DOMException('手部识别 Worker 初始化已取消。', 'AbortError')

export class HandTrackingClient {
  private readonly worker: Worker
  private readonly generation: number
  private readonly callbacks: HandTrackingClientCallbacks
  private readonly sentAt = new Map<number, number>()
  private nextFrameId = 1
  private acceptFromFrameId = 1
  private inFlightFrameId: number | null = null
  private disposeTimer: number | null = null
  private workerTerminated = false
  private disposed = false
  private ready = false

  private constructor(worker: Worker, generation: number, callbacks: HandTrackingClientCallbacks) {
    this.worker = worker
    this.generation = generation
    this.callbacks = callbacks
  }

  static create(callbacks: HandTrackingClientCallbacks, signal?: AbortSignal): Promise<HandTrackingClient> {
    const worker = new Worker(new URL('./handTracking.worker.ts', import.meta.url), { type: 'module', name: 'doctorar-vision' })
    const generation = Math.floor(performance.now() * 1000 + Math.random() * 1000)
    const client = new HandTrackingClient(worker, generation, callbacks)
    return client.initialize(signal)
  }

  get busy(): boolean {
    return this.inFlightFrameId !== null
  }

  submit(bitmap: ImageBitmap, options: HandTrackingFrameOptions): boolean {
    if (this.disposed || !this.ready || this.inFlightFrameId !== null) {
      bitmap.close()
      return false
    }

    const frameId = this.nextFrameId
    this.nextFrameId += 1
    this.inFlightFrameId = frameId
    this.sentAt.set(frameId, performance.now())
    const message: VisionWorkerRequest = {
      type: 'FRAME',
      generation: this.generation,
      frameId,
      bitmap,
      ...options,
    }
    try {
      this.worker.postMessage(message, [bitmap])
    } catch {
      this.sentAt.delete(frameId)
      if (this.inFlightFrameId === frameId) this.inFlightFrameId = null
      bitmap.close()
      return false
    }
    return true
  }

  reset(): void {
    if (this.disposed || !this.ready) return
    this.inFlightFrameId = null
    this.sentAt.clear()
    this.acceptFromFrameId = this.nextFrameId
    try {
      this.worker.postMessage({ type: 'RESET', generation: this.generation } satisfies VisionWorkerRequest)
    } catch {
      this.callbacks.onError('无法重置手部识别 Worker。')
      this.dispose()
    }
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.ready = false
    this.inFlightFrameId = null
    this.sentAt.clear()
    try {
      this.worker.postMessage({ type: 'DISPOSE', generation: this.generation } satisfies VisionWorkerRequest)
      this.disposeTimer = window.setTimeout(() => this.finishDispose(), DISPOSE_TIMEOUT_MS)
    } catch {
      this.finishDispose()
    }
  }

  private initialize(signal?: AbortSignal): Promise<HandTrackingClient> {
    return new Promise((resolve, reject) => {
      let settled = false
      const cleanupInitialization = (): void => {
        window.clearTimeout(timeout)
        signal?.removeEventListener('abort', handleAbort)
      }
      const rejectInitialization = (error: Error): void => {
        if (settled) return
        settled = true
        cleanupInitialization()
        this.dispose()
        reject(error)
      }
      const handleAbort = (): void => rejectInitialization(abortError())
      const timeout = window.setTimeout(() => {
        rejectInitialization(new Error('手部识别 Worker 初始化超时。'))
      }, INIT_TIMEOUT_MS)

      const fail = (message: string): void => {
        rejectInitialization(new Error(message))
      }

      if (signal?.aborted) {
        handleAbort()
        return
      }
      signal?.addEventListener('abort', handleAbort, { once: true })

      this.worker.onerror = (event): void => {
        const message = event.message || '手部识别 Worker 加载失败。'
        if (!this.ready) {
          fail(message)
          return
        }
        this.inFlightFrameId = null
        this.sentAt.clear()
        this.callbacks.onError(message)
        this.dispose()
      }
      this.worker.onmessage = (event: MessageEvent<VisionWorkerResponse>): void => {
        const message = event.data
        if (message.generation !== this.generation) return

        if (message.type === 'DISPOSED') {
          this.finishDispose()
          return
        }

        if (this.disposed) return

        if (message.type === 'READY') {
          if (settled) return
          settled = true
          cleanupInitialization()
          this.ready = true
          resolve(this)
          return
        }

        if (message.type === 'ERROR') {
          if (!this.ready) {
            fail(message.message)
            return
          }
          if (message.frameId !== undefined) {
            this.sentAt.delete(message.frameId)
            if (message.frameId < this.acceptFromFrameId || message.frameId !== this.inFlightFrameId) return
            this.inFlightFrameId = null
          } else {
            this.inFlightFrameId = null
            this.sentAt.clear()
          }
          this.callbacks.onError(message.message)
          return
        }

        if (message.type === 'RESULT') {
          const startedAt = this.sentAt.get(message.frameId)
          this.sentAt.delete(message.frameId)
          if (message.frameId < this.acceptFromFrameId || message.frameId !== this.inFlightFrameId) return
          this.inFlightFrameId = null
          this.callbacks.onResult({
            frame: message.frame,
            roundTripMs: startedAt === undefined ? 0 : performance.now() - startedAt,
          })
          return
        }

        this.finishDispose()
      }

      try {
        this.worker.postMessage({ type: 'INIT', generation: this.generation } satisfies VisionWorkerRequest)
      } catch (error) {
        rejectInitialization(error instanceof Error ? error : new Error('无法启动手部识别 Worker。'))
      }
    })
  }

  private finishDispose(): void {
    if (this.disposeTimer !== null) {
      window.clearTimeout(this.disposeTimer)
      this.disposeTimer = null
    }
    if (this.workerTerminated) return
    this.workerTerminated = true
    this.worker.terminate()
  }
}
