import type { VisionWorkerRequest, VisionWorkerResponse } from '../types/visionWorker'
import { HandTracker } from './HandTracker'

interface WorkerScope {
  postMessage(message: VisionWorkerResponse): void
  close(): void
  onmessage: ((event: MessageEvent<VisionWorkerRequest>) => void) | null
}

const scope = globalThis as unknown as WorkerScope
let tracker: HandTracker | null = null
let generation = 0
let disposed = false

const reportError = (requestGeneration: number, error: unknown, frameId?: number): void => {
  if (disposed) return
  scope.postMessage({
    type: 'ERROR',
    generation: requestGeneration,
    ...(frameId === undefined ? {} : { frameId }),
    message: error instanceof Error ? error.message : '手部识别 Worker 运行失败。',
  })
}

scope.onmessage = (event): void => {
  const message = event.data

  if (disposed) {
    if (message.type === 'FRAME') message.bitmap.close()
    return
  }

  if (message.type === 'INIT') {
    generation = message.generation
    void HandTracker.create({ mirrored: true, inputIsMirrored: false, useWasmModule: true }).then((created) => {
      if (disposed || generation !== message.generation) {
        created.dispose()
        return
      }
      tracker?.dispose()
      tracker = created
      scope.postMessage({ type: 'READY', generation })
    }).catch((error: unknown) => {
      if (!disposed && generation === message.generation) reportError(message.generation, error)
    })
    return
  }

  if (message.generation !== generation) {
    if (message.type === 'FRAME') message.bitmap.close()
    return
  }

  if (message.type === 'FRAME') {
    try {
      if (!tracker) throw new Error('手部识别 Worker 尚未准备完成。')
      const frame = tracker.detectSource(
        message.bitmap,
        message.timestamp,
        message.videoWidth,
        message.videoHeight,
        message.smoothing,
        message.sensitivity,
      )
      scope.postMessage({ type: 'RESULT', generation, frameId: message.frameId, frame })
    } catch (error) {
      reportError(generation, error, message.frameId)
    } finally {
      message.bitmap.close()
    }
    return
  }

  if (message.type === 'RESET') {
    tracker?.reset()
    return
  }

  disposed = true
  tracker?.dispose()
  tracker = null
  try {
    scope.postMessage({ type: 'DISPOSED', generation })
  } finally {
    scope.close()
  }
}
