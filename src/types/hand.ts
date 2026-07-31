export type Handedness = 'left' | 'right'

export interface Vector2Like {
  x: number
  y: number
}

export interface Vector3Like extends Vector2Like {
  z: number
}

export interface HandLandmark extends Vector3Like {
  visibility?: number
}

export type FingerName = 'thumb' | 'index' | 'middle' | 'ring' | 'pinky'

export interface FingerPose {
  extended: boolean
  curl: number
}

export type FingerPoses = Record<FingerName, FingerPose>

export interface PalmMetrics {
  center: Vector3Like
  width: number
  rotation: number
  normal: Vector3Like
  facingScore: number
  facesCamera: boolean
}

export interface GestureScores {
  open: number
  fist: number
  pinch: number
}

export type GestureLabel = 'open' | 'fist' | 'pinch' | 'neutral'

export interface TrackedHand {
  handedness: Handedness
  handednessConfidence: number
  trackingQuality: number
  landmarks: HandLandmark[]
  worldLandmarks: HandLandmark[]
  palm: PalmMetrics
  fingers: FingerPoses
  scores: GestureScores
  gesture: GestureLabel
  velocity: Vector2Like
  speed: number
  seenAt: number
}

export interface TwoHandMetrics {
  center: Vector3Like
  distance: number
  distanceVelocity: number
  oppositionScore: number
  ready: boolean
}

export interface HandFrame {
  hands: TrackedHand[]
  twoHand: TwoHandMetrics | null
  timestamp: number
  inferenceMs: number
  videoWidth: number
  videoHeight: number
}
