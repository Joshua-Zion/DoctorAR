import type { HandLandmark } from '../../types/hand'

export interface LandmarkFilter {
  filter(key: string, landmarks: readonly HandLandmark[], timestampMs: number): HandLandmark[]
  reset(key?: string): void
  setSmoothing?(smoothing: number): void
}
