import type { Handedness, TrackedHand, Vector3Like } from './hand'

export type GesturePhase = 'idle' | 'candidate' | 'active' | 'released' | 'cooldown'

export interface GesturePose {
  position: Vector3Like
  width: number
  rotation: number
  normal: Vector3Like
  confidence: number
}

export type GestureEvent =
  | { type: 'PALM_OPEN'; hand: Handedness; pose: GesturePose }
  | { type: 'PALM_UPDATE'; hand: Handedness; pose: GesturePose }
  | { type: 'PALM_CLOSE'; hand: Handedness }
  | { type: 'FIST'; hand: Handedness; pose: GesturePose; intensity: number }
  | { type: 'HAND_LOST'; hand: Handedness }
  | { type: 'TWO_HAND_CHARGE_START'; center: Vector3Like; distance: number }
  | { type: 'TWO_HAND_CHARGE_UPDATE'; center: Vector3Like; distance: number; velocity: number }
  | { type: 'TWO_HAND_CHARGE_END' }
  | { type: 'TWO_HAND_RELEASE'; center: Vector3Like; velocity: number }
  | { type: 'PINCH_START'; hand: Handedness; position: Vector3Like }
  | { type: 'PINCH_MOVE'; hand: Handedness; position: Vector3Like }
  | { type: 'PINCH_END'; hand: Handedness }

export interface HandGestureSnapshot {
  hand: TrackedHand
  openPhase: GesturePhase
  fistPhase: GesturePhase
  pinchPhase: GesturePhase
}
