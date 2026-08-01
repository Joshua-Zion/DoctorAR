import { describe, expect, it } from 'vitest'
import { TwoHandReleaseDetector } from './TwoHandReleaseDetector'

interface MotionSample {
  timestamp: number
  distance: number
}

const run = (samples: MotionSample[]): boolean => {
  const detector = new TwoHandReleaseDetector()
  return samples.some((sample) => detector.update({ ...sample, chargeActive: true, valid: true }).triggered)
}

describe('TwoHandReleaseDetector', () => {
  it('triggers once after a sustained compression followed by a fast expansion', () => {
    const detector = new TwoHandReleaseDetector()
    const samples: MotionSample[] = [
      { timestamp: 0, distance: 0.36 },
      { timestamp: 50, distance: 0.28 },
      { timestamp: 100, distance: 0.22 },
      { timestamp: 180, distance: 0.21 },
      { timestamp: 240, distance: 0.22 },
      { timestamp: 280, distance: 0.25 },
      { timestamp: 320, distance: 0.32 },
      { timestamp: 350, distance: 0.39 },
    ]

    const triggers = samples.filter((sample) => detector.update({ ...sample, chargeActive: true }).triggered)
    expect(triggers).toHaveLength(1)
    expect(detector.phase).toBe('cooldown')
  })

  it('does not trigger for a slow expansion', () => {
    expect(run([
      { timestamp: 0, distance: 0.35 },
      { timestamp: 80, distance: 0.23 },
      { timestamp: 210, distance: 0.22 },
      { timestamp: 360, distance: 0.25 },
      { timestamp: 520, distance: 0.29 },
      { timestamp: 700, distance: 0.34 },
    ])).toBe(false)
  })

  it('does not trigger when already-separated hands enter the frame', () => {
    expect(run([
      { timestamp: 0, distance: 0.42 },
      { timestamp: 35, distance: 0.49 },
      { timestamp: 70, distance: 0.57 },
      { timestamp: 105, distance: 0.65 },
    ])).toBe(false)
  })

  it('resets an armed sequence after tracking becomes invalid', () => {
    const detector = new TwoHandReleaseDetector()
    detector.update({ timestamp: 0, distance: 0.34, chargeActive: true })
    detector.update({ timestamp: 70, distance: 0.22, chargeActive: true })
    detector.update({ timestamp: 200, distance: 0.21, chargeActive: true })
    expect(detector.isArmed).toBe(true)
    detector.update({ timestamp: 380, distance: 0.21, chargeActive: false, valid: false })
    expect(detector.phase).toBe('idle')
  })
})
