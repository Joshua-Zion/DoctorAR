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
  pinch: { enterScore: 0.72, exitScore: 0.5, minHoldMs: 60, maxInterruptMs: 110, cooldownMs: 160, confidence: 0.48 },
  twoHand: {
    enterScore: 0.54,
    exitScore: 0.34,
    minHoldMs: 90,
    maxInterruptMs: 240,
    cooldownMs: 260,
    confidence: 0.46,
    minDistance: 0.1,
    maxDistance: 0.74,
    longFingerScore: 0.52,
    orientationScore: 0.28,
    releaseVelocity: 0.5,
  },
  palm: { facingThreshold: 0.34, minWidth: 0.035, maxWidth: 0.34 },
  loss: { holdMs: 140, fadeMs: 420, hideMs: 700 },
} as const
