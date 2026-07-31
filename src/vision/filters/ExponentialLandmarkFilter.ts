import type { HandLandmark } from '../../types/hand'
import { clamp } from '../../utils/math'
import type { LandmarkFilter } from './LandmarkFilter'

interface FilterState {
  landmarks: HandLandmark[]
  timestampMs: number
}

const cloneLandmark = (landmark: HandLandmark): HandLandmark => ({ ...landmark })

export class ExponentialLandmarkFilter implements LandmarkFilter {
  private readonly states = new Map<string, FilterState>()
  private smoothingValue: number

  constructor(smoothing = 0.68) {
    this.smoothingValue = clamp(smoothing, 0, 0.96)
  }

  setSmoothing(smoothing: number): void {
    this.smoothingValue = clamp(smoothing, 0, 0.96)
  }

  filter(key: string, landmarks: readonly HandLandmark[], timestampMs: number): HandLandmark[] {
    const previous = this.states.get(key)
    if (!previous || previous.landmarks.length !== landmarks.length || timestampMs - previous.timestampMs > 250) {
      const initial = landmarks.map(cloneLandmark)
      this.states.set(key, { landmarks: initial, timestampMs })
      return initial.map(cloneLandmark)
    }

    const elapsedFrames = clamp((timestampMs - previous.timestampMs) / (1000 / 60), 0.25, 4)
    const retention = this.smoothingValue ** elapsedFrames
    const alpha = 1 - retention
    const filtered = landmarks.map((landmark, index) => {
      const prior = previous.landmarks[index]
      const visibility = Number.isFinite(landmark.visibility)
        ? (prior.visibility ?? landmark.visibility ?? 0) * retention + (landmark.visibility ?? 0) * alpha
        : undefined

      return {
        x: prior.x * retention + landmark.x * alpha,
        y: prior.y * retention + landmark.y * alpha,
        z: prior.z * retention + landmark.z * alpha,
        ...(visibility === undefined ? {} : { visibility }),
      }
    })

    this.states.set(key, { landmarks: filtered, timestampMs })
    return filtered.map(cloneLandmark)
  }

  reset(key?: string): void {
    if (key === undefined) this.states.clear()
    else this.states.delete(key)
  }
}
