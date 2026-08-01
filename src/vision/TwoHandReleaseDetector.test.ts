import { describe, expect, it } from 'vitest'
import { TwoHandReleaseDetector } from './TwoHandReleaseDetector'

interface MotionSample {
  timestamp: number
  distance: number
  valid?: boolean
}

const run = (samples: MotionSample[]): boolean => {
  const detector = new TwoHandReleaseDetector()
  return samples.some((sample) => detector.update({ chargeActive: true, valid: true, ...sample }).triggered)
}

const motionAtFps = (fps: number, dropAtIndex = -1): MotionSample[] => {
  const frameMs = 1000 / fps
  const samples: MotionSample[] = []
  for (let index = 0; index * frameMs <= 420; index += 1) {
    const timestamp = index * frameMs
    const baseDistance = timestamp <= 140
      ? 0.36 - 0.14 * (timestamp / 140)
      : timestamp <= 220
        ? 0.22
        : 0.22 + 0.13 * Math.min(1, (timestamp - 220) / 160)
    const jitter = (index % 3 - 1) * 0.0025
    samples.push({ timestamp, distance: baseDistance + jitter, valid: index !== dropAtIndex })
  }
  return samples
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

  it.each([18, 28, 40])('recognizes the same noisy motion at %i fps', (fps) => {
    expect(run(motionAtFps(fps))).toBe(true)
  })

  it('bridges one missed inference frame during a 28 fps release', () => {
    expect(run(motionAtFps(28, 8))).toBe(true)
  })

  it('records pre-charge approach samples but never releases until explicitly enabled', () => {
    const detector = new TwoHandReleaseDetector()
    const approach: MotionSample[] = [
      { timestamp: 0, distance: 0.36 },
      { timestamp: 35, distance: 0.31 },
      { timestamp: 70, distance: 0.25 },
    ]
    for (const sample of approach) {
      expect(detector.update({ ...sample, chargeActive: false, releaseEnabled: false }).triggered).toBe(false)
    }

    detector.update({ timestamp: 105, distance: 0.23, chargeActive: true, releaseEnabled: false })
    const armed = detector.update({ timestamp: 180, distance: 0.22, chargeActive: true, releaseEnabled: false })
    expect(armed.armedThisFrame).toBe(true)

    expect(detector.update({ timestamp: 220, distance: 0.28, chargeActive: true, releaseEnabled: false }).triggered).toBe(false)
    expect(detector.update({ timestamp: 260, distance: 0.35, chargeActive: true, releaseEnabled: false }).triggered).toBe(false)
    expect(detector.update({ timestamp: 295, distance: 0.36, chargeActive: true, releaseEnabled: true }).triggered).toBe(true)
  })

  it('never triggers from an 80 ms old invalid expansion sample', () => {
    const detector = new TwoHandReleaseDetector()
    detector.update({ timestamp: 0, distance: 0.35, chargeActive: true })
    detector.update({ timestamp: 70, distance: 0.24, chargeActive: true })
    detector.update({ timestamp: 145, distance: 0.22, chargeActive: true })
    expect(detector.isArmed).toBe(true)

    const stale = detector.update({
      timestamp: 225,
      distance: 0.36,
      distanceVelocity: 1.75,
      outwardVelocity: 1.75,
      chargeActive: true,
      releaseEnabled: true,
      valid: false,
      resetVelocityOnRecovery: true,
    })
    expect(stale.triggered).toBe(false)

    const reacquired = detector.update({
      timestamp: 230,
      distance: 0.37,
      distanceVelocity: 2,
      outwardVelocity: 2,
      chargeActive: true,
      releaseEnabled: true,
      valid: true,
    })
    expect(reacquired.triggered).toBe(false)
  })

  it('does not replay a qualified candidate release after the hands close again', () => {
    const detector = new TwoHandReleaseDetector()
    detector.update({ timestamp: 0, distance: 0.36, chargeActive: true, releaseEnabled: false })
    detector.update({ timestamp: 50, distance: 0.24, chargeActive: true, releaseEnabled: false })
    detector.update({ timestamp: 125, distance: 0.22, chargeActive: true, releaseEnabled: false })
    detector.update({ timestamp: 170, distance: 0.3, chargeActive: true, releaseEnabled: false })
    detector.update({ timestamp: 205, distance: 0.36, chargeActive: true, releaseEnabled: false })

    const closedAgain = detector.update({
      timestamp: 240,
      distance: 0.25,
      chargeActive: true,
      releaseEnabled: true,
    })
    expect(closedAgain.triggered).toBe(false)
  })

  it('resets an armed sequence after tracking becomes invalid', () => {
    const detector = new TwoHandReleaseDetector()
    detector.update({ timestamp: 0, distance: 0.34, chargeActive: true })
    detector.update({ timestamp: 70, distance: 0.22, chargeActive: true })
    detector.update({ timestamp: 200, distance: 0.21, chargeActive: true })
    expect(detector.isArmed).toBe(true)
    detector.update({ timestamp: 460, distance: 0.21, chargeActive: false, valid: false })
    expect(detector.phase).toBe('idle')
  })
})
