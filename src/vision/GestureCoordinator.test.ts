import { describe, expect, it } from 'vitest'
import type { GestureEvent } from '../types/gesture'
import type { FingerPoses, HandFrame, HandLandmark, Handedness, TrackedHand } from '../types/hand'
import { GestureCoordinator } from './GestureCoordinator'
import { GestureEventBus } from './GestureEventBus'

const fingers: FingerPoses = {
  thumb: { extended: false, curl: 0.5 },
  index: { extended: false, curl: 0.5 },
  middle: { extended: false, curl: 0.5 },
  ring: { extended: false, curl: 0.5 },
  pinky: { extended: false, curl: 0.5 },
}

const createHand = (timestamp: number, pinch: number): TrackedHand => {
  const landmarks: HandLandmark[] = Array.from({ length: 21 }, () => ({ x: 0.3, y: 0.5, z: 0 }))
  landmarks[4] = { x: 0.2, y: 0.4, z: -0.1 }
  landmarks[8] = { x: 0.4, y: 0.6, z: 0.1 }
  return {
    handedness: 'left',
    handednessConfidence: 0.99,
    trackingQuality: 0.99,
    landmarks,
    worldLandmarks: [],
    palm: {
      center: { x: 0.3, y: 0.5, z: 0 },
      width: 0.12,
      rotation: 0,
      normal: { x: 0, y: 0, z: 1 },
      facingScore: 1,
      facesCamera: true,
    },
    fingers,
    scores: { open: 0, fist: 0, pinch },
    gesture: pinch > 0.5 ? 'pinch' : 'neutral',
    velocity: { x: 0, y: 0 },
    speed: 0,
    seenAt: timestamp,
  }
}

const createFrame = (timestamp: number, pinch: number): HandFrame => ({
  hands: [createHand(timestamp, pinch)],
  twoHand: null,
  timestamp,
  inferenceMs: 4,
  videoWidth: 1280,
  videoHeight: 720,
})

const createOpenHand = (
  handedness: Handedness,
  timestamp: number,
  x: number,
  velocityX: number,
): TrackedHand => {
  const hand = createHand(timestamp, 0)
  return {
    ...hand,
    handedness,
    palm: {
      ...hand.palm,
      center: { x, y: 0.5, z: 0 },
      normal: { x: handedness === 'left' ? -1 : 1, y: 0, z: 0 },
    },
    scores: { open: 1, fist: 0, pinch: 0 },
    gesture: 'open',
    velocity: { x: velocityX, y: 0 },
    speed: Math.abs(velocityX),
  }
}

const createDualFrame = (
  timestamp: number,
  distance: number,
  distanceVelocity: number,
  staleRight = false,
): HandFrame => ({
  hands: [
    createOpenHand('left', timestamp, 0.5 - distance / 2, -distanceVelocity / 2),
    createOpenHand('right', staleRight ? timestamp - 80 : timestamp, 0.5 + distance / 2, distanceVelocity / 2),
  ],
  twoHand: {
    center: { x: 0.5, y: 0.5, z: 0 },
    distance,
    distanceVelocity,
    oppositionScore: 1,
    ready: true,
  },
  timestamp,
  inferenceMs: 4,
  videoWidth: 1280,
  videoHeight: 720,
})

describe('GestureCoordinator pinch events', () => {
  it('emits an ordered pinch lifecycle at the thumb/index midpoint', () => {
    const eventBus = new GestureEventBus()
    const coordinator = new GestureCoordinator(eventBus)
    const events: GestureEvent[] = []
    eventBus.subscribe((event) => events.push(event))

    coordinator.process(createFrame(10, 1), { sensitivity: 0.85, cooldownMs: 10 })
    coordinator.process(createFrame(100, 1), { sensitivity: 0.85, cooldownMs: 10 })
    coordinator.process(createFrame(130, 1), { sensitivity: 0.85, cooldownMs: 10 })
    coordinator.process(createFrame(150, 0), { sensitivity: 0.85, cooldownMs: 10 })
    coordinator.process(createFrame(250, 0), { sensitivity: 0.85, cooldownMs: 10 })

    const pinchEvents = events.filter((event) => event.type.startsWith('PINCH_'))
    expect(pinchEvents.map((event) => event.type)).toEqual([
      'PINCH_START',
      'PINCH_MOVE',
      'PINCH_MOVE',
      'PINCH_MOVE',
      'PINCH_END',
    ])
    const start = pinchEvents[0]
    expect(start.type).toBe('PINCH_START')
    if (start.type !== 'PINCH_START') throw new Error('Expected PINCH_START')
    expect(start.position.x).toBeCloseTo(0.3)
    expect(start.position.y).toBeCloseTo(0.5)
    expect(start.position.z).toBeCloseTo(0)
  })
})

describe('GestureCoordinator two-hand release events', () => {
  const releaseMotion = [
    createDualFrame(0, 0.35, 0),
    createDualFrame(80, 0.24, -1.38),
    createDualFrame(160, 0.21, -0.38),
    createDualFrame(230, 0.2, -0.14),
    createDualFrame(300, 0.21, 0.14),
    createDualFrame(340, 0.25, 1),
    createDualFrame(380, 0.33, 2),
  ]

  it('ends the charge before emitting one strict release event', () => {
    const eventBus = new GestureEventBus()
    const coordinator = new GestureCoordinator(eventBus)
    const events: GestureEvent[] = []
    eventBus.subscribe((event) => events.push(event))

    for (const frame of releaseMotion) coordinator.process(frame, { sensitivity: 0.85, cooldownMs: 10 })

    const twoHandEvents = events.filter((event) => event.type.startsWith('TWO_HAND_'))
    const releaseIndex = twoHandEvents.findIndex((event) => event.type === 'TWO_HAND_RELEASE')
    expect(releaseIndex).toBeGreaterThan(0)
    expect(twoHandEvents[releaseIndex - 1]?.type).toBe('TWO_HAND_CHARGE_END')
    expect(twoHandEvents.filter((event) => event.type === 'TWO_HAND_RELEASE')).toHaveLength(1)
  })

  it('rejects a release sample that contains a held hand from an older inference frame', () => {
    const eventBus = new GestureEventBus()
    const coordinator = new GestureCoordinator(eventBus)
    const events: GestureEvent[] = []
    eventBus.subscribe((event) => events.push(event))

    for (const frame of releaseMotion.slice(0, -1)) coordinator.process(frame, { sensitivity: 0.85, cooldownMs: 10 })
    coordinator.process(createDualFrame(380, 0.33, 2, true), { sensitivity: 0.85, cooldownMs: 10 })

    expect(events.some((event) => event.type === 'TWO_HAND_RELEASE')).toBe(false)
  })
})
