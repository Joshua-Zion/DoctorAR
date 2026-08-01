import { afterEach, describe, expect, it, vi } from 'vitest'
import type { HandFrame } from '../types/hand'
import type { VisionWorkerRequest, VisionWorkerResponse } from '../types/visionWorker'
import { HandTrackingClient } from './HandTrackingClient'

class FakeWorker {
  static latest: FakeWorker | null = null

  readonly messages: VisionWorkerRequest[] = []
  readonly terminate = vi.fn()
  onerror: ((event: ErrorEvent) => void) | null = null
  onmessage: ((event: MessageEvent<VisionWorkerResponse>) => void) | null = null

  constructor() {
    FakeWorker.latest = this
  }

  postMessage(message: VisionWorkerRequest): void {
    this.messages.push(message)
  }

  emit(message: VisionWorkerResponse): void {
    this.onmessage?.({ data: message } as MessageEvent<VisionWorkerResponse>)
  }
}

const emptyFrame = (timestamp: number): HandFrame => ({
  hands: [],
  twoHand: null,
  timestamp,
  inferenceMs: 4,
  videoWidth: 640,
  videoHeight: 480,
})

const bitmap = (): ImageBitmap => ({ close: vi.fn() }) as unknown as ImageBitmap

afterEach(() => {
  FakeWorker.latest = null
  vi.unstubAllGlobals()
})

describe('HandTrackingClient frame ownership', () => {
  it('does not let a stale pre-reset result release the current in-flight frame', async () => {
    vi.stubGlobal('window', globalThis)
    vi.stubGlobal('Worker', FakeWorker)
    const onResult = vi.fn()
    const creating = HandTrackingClient.create({ onResult, onError: vi.fn() })
    const worker = FakeWorker.latest
    expect(worker).not.toBeNull()
    const init = worker?.messages[0]
    if (!worker || !init || init.type !== 'INIT') throw new Error('Expected Worker INIT')
    worker.emit({ type: 'READY', generation: init.generation })
    const client = await creating

    expect(client.submit(bitmap(), {
      timestamp: 10,
      videoWidth: 640,
      videoHeight: 480,
      smoothing: 0.68,
      sensitivity: 0.58,
    })).toBe(true)
    const first = worker.messages.find((message) => message.type === 'FRAME')
    if (!first || first.type !== 'FRAME') throw new Error('Expected first FRAME')

    client.reset()
    expect(client.submit(bitmap(), {
      timestamp: 20,
      videoWidth: 640,
      videoHeight: 480,
      smoothing: 0.68,
      sensitivity: 0.58,
    })).toBe(true)
    const frames = worker.messages.filter((message) => message.type === 'FRAME')
    const second = frames[1]
    if (!second || second.type !== 'FRAME') throw new Error('Expected second FRAME')

    worker.emit({
      type: 'RESULT',
      generation: init.generation,
      frameId: first.frameId,
      frame: emptyFrame(10),
    })
    expect(client.busy).toBe(true)
    expect(onResult).not.toHaveBeenCalled()

    worker.emit({
      type: 'RESULT',
      generation: init.generation,
      frameId: second.frameId,
      frame: emptyFrame(20),
    })
    expect(client.busy).toBe(false)
    expect(onResult).toHaveBeenCalledOnce()

    client.dispose()
    worker.emit({ type: 'DISPOSED', generation: init.generation })
    expect(worker.terminate).toHaveBeenCalledOnce()
  })
})
