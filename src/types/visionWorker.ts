import type { HandFrame } from './hand'

export interface VisionWorkerInitMessage {
  type: 'INIT'
  generation: number
}

export interface VisionWorkerFrameMessage {
  type: 'FRAME'
  generation: number
  frameId: number
  bitmap: ImageBitmap
  timestamp: number
  videoWidth: number
  videoHeight: number
  smoothing: number
  sensitivity: number
}

export interface VisionWorkerResetMessage {
  type: 'RESET'
  generation: number
}

export interface VisionWorkerDisposeMessage {
  type: 'DISPOSE'
  generation: number
}

export type VisionWorkerRequest =
  | VisionWorkerInitMessage
  | VisionWorkerFrameMessage
  | VisionWorkerResetMessage
  | VisionWorkerDisposeMessage

export interface VisionWorkerReadyMessage {
  type: 'READY'
  generation: number
}

export interface VisionWorkerResultMessage {
  type: 'RESULT'
  generation: number
  frameId: number
  frame: HandFrame
}

export interface VisionWorkerErrorMessage {
  type: 'ERROR'
  generation: number
  frameId?: number
  message: string
}

export interface VisionWorkerDisposedMessage {
  type: 'DISPOSED'
  generation: number
}

export type VisionWorkerResponse =
  | VisionWorkerReadyMessage
  | VisionWorkerResultMessage
  | VisionWorkerErrorMessage
  | VisionWorkerDisposedMessage
