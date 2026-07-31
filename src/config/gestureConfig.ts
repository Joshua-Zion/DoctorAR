export const HAND_TRACKER_CONFIG = {
  numHands: 2,
  minHandDetectionConfidence: 0.55,
  minHandPresenceConfidence: 0.52,
  minTrackingConfidence: 0.5,
  modelPath: '/models/hand_landmarker.task',
  wasmPath: '/mediapipe/wasm',
} as const

export const GESTURE_CONFIG = {
  open: { enterScore: 0.72, exitScore: 0.55, minHoldMs: 110, maxInterruptMs: 130, cooldownMs: 180, confidence: 0.55 },
  fist: { enterScore: 0.7, exitScore: 0.48, minHoldMs: 80, maxInterruptMs: 100, cooldownMs: 720, confidence: 0.52 },
  pinch: { enterScore: 0.8, exitScore: 0.62, minHoldMs: 80, maxInterruptMs: 90, cooldownMs: 180, confidence: 0.5 },
  twoHand: {
    enterScore: 0.66,
    exitScore: 0.46,
    minHoldMs: 140,
    maxInterruptMs: 160,
    cooldownMs: 260,
    confidence: 0.52,
    minDistance: 0.12,
    maxDistance: 0.68,
    releaseVelocity: 0.82,
  },
  palm: { facingThreshold: 0.34, minWidth: 0.035, maxWidth: 0.34 },
  loss: { holdMs: 140, fadeMs: 420, hideMs: 700 },
} as const
