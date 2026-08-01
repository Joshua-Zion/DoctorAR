import { describe, expect, it } from 'vitest'
import type { FingerPoses, HandLandmark, Handedness, TrackedHand, Vector3Like } from '../types/hand'
import { CoordinateMapper } from './CoordinateMapper'
import { GestureRecognizer } from './GestureRecognizer'

const createFingers = (longFingerCurl = 0): FingerPoses => ({
  thumb: { extended: true, curl: 0 },
  index: { extended: longFingerCurl < 0.5, curl: longFingerCurl },
  middle: { extended: longFingerCurl < 0.5, curl: longFingerCurl },
  ring: { extended: longFingerCurl < 0.5, curl: longFingerCurl },
  pinky: { extended: longFingerCurl < 0.5, curl: longFingerCurl },
})

const createHand = (
  handedness: Handedness,
  x: number,
  normal: Vector3Like,
  facingScore: number,
  openScore: number,
  longFingerCurl = 0,
): TrackedHand => {
  const landmarks: HandLandmark[] = Array.from({ length: 21 }, () => ({ x, y: 0.5, z: 0 }))
  return {
    handedness,
    handednessConfidence: 0.99,
    trackingQuality: 0.99,
    landmarks,
    worldLandmarks: [],
    palm: {
      center: { x, y: 0.5, z: 0 },
      width: 0.1,
      rotation: 0,
      normal,
      facingScore,
      facesCamera: facingScore >= 0.34,
    },
    fingers: createFingers(longFingerCurl),
    scores: { open: openScore, fist: 0, pinch: 0 },
    gesture: openScore > 0.5 ? 'open' : 'neutral',
    velocity: { x: 0, y: 0 },
    speed: 0,
    seenAt: 0,
  }
}

const createRecognizer = (): GestureRecognizer => new GestureRecognizer(new CoordinateMapper({
  mirrored: true,
  videoWidth: 1280,
  videoHeight: 720,
}))

describe('GestureRecognizer two-hand readiness', () => {
  it('accepts extended fingers when the palms face each other even if camera-gated open scores are low', () => {
    const recognizer = createRecognizer()
    const metric = recognizer.computeTwoHandMetrics([
      createHand('left', 0.35, { x: 1, y: 0, z: 0 }, 0, 0.286),
      createHand('right', 0.65, { x: -1, y: 0, z: 0 }, 0, 0.286),
    ], null, 0)

    expect(metric?.ready).toBe(true)
    expect(metric?.oppositionScore).toBeCloseTo(1)
  })

  it('also accepts two open palms facing the camera', () => {
    const recognizer = createRecognizer()
    const metric = recognizer.computeTwoHandMetrics([
      createHand('left', 0.35, { x: 0, y: 0, z: -1 }, 1, 1),
      createHand('right', 0.65, { x: 0, y: 0, z: -1 }, 1, 1),
    ], null, 0)

    expect(metric?.ready).toBe(true)
    expect(metric?.oppositionScore).toBeCloseTo(1)
  })

  it('rejects curled long fingers even when palm orientation is ideal', () => {
    const recognizer = createRecognizer()
    const metric = recognizer.computeTwoHandMetrics([
      createHand('left', 0.35, { x: 1, y: 0, z: 0 }, 0, 0.286, 0.72),
      createHand('right', 0.65, { x: -1, y: 0, z: 0 }, 0, 0.286, 0.72),
    ], null, 0)

    expect(metric?.ready).toBe(false)
  })
})
