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

const openFingers: FingerPoses = {
  thumb: { extended: true, curl: 0.16 },
  index: { extended: true, curl: 0.06 },
  middle: { extended: true, curl: 0.06 },
  ring: { extended: true, curl: 0.06 },
  pinky: { extended: true, curl: 0.06 },
}

const createHand = (timestamp: number, pinch: number, fist = 0): TrackedHand => {
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
    scores: { open: 0, fist, pinch },
    gesture: pinch > 0.5 ? 'pinch' : 'neutral',
    velocity: { x: 0, y: 0 },
    speed: 0,
    seenAt: timestamp,
  }
}

const createFrame = (timestamp: number, pinch: number, fist = 0): HandFrame => ({
  hands: [createHand(timestamp, pinch, fist)],
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
    fingers: openFingers,
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

    coordinator.process(createFrame(10, 1), { sensitivity: 0.85, cooldownMs: 720 })
    coordinator.process(createFrame(100, 1), { sensitivity: 0.85, cooldownMs: 720 })
    coordinator.process(createFrame(130, 1), { sensitivity: 0.85, cooldownMs: 720 })
    coordinator.process(createFrame(150, 0), { sensitivity: 0.85, cooldownMs: 720 })
    coordinator.process(createFrame(270, 0), { sensitivity: 0.85, cooldownMs: 720 })

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

  it('lets a strong pinch own the hand instead of firing a competing fist burst', () => {
    const eventBus = new GestureEventBus()
    const coordinator = new GestureCoordinator(eventBus)
    const events: GestureEvent[] = []
    eventBus.subscribe((event) => events.push(event))

    coordinator.process(createFrame(0, 1, 1), { sensitivity: 0.85, cooldownMs: 720 })
    coordinator.process(createFrame(100, 1, 1), { sensitivity: 0.85, cooldownMs: 720 })
    coordinator.process(createFrame(140, 1, 1), { sensitivity: 0.85, cooldownMs: 720 })

    expect(events.some((event) => event.type === 'PINCH_START')).toBe(true)
    expect(events.some((event) => event.type === 'PINCH_MOVE')).toBe(true)
    expect(events.some((event) => event.type === 'FIST')).toBe(false)
  })

  it('does not let a borderline pinch score starve a clearly stronger fist', () => {
    const eventBus = new GestureEventBus()
    const coordinator = new GestureCoordinator(eventBus)
    const events: GestureEvent[] = []
    eventBus.subscribe((event) => events.push(event))

    coordinator.process(createFrame(0, 0.68, 1), { sensitivity: 0.58, cooldownMs: 720 })
    coordinator.process(createFrame(100, 0.68, 1), { sensitivity: 0.58, cooldownMs: 720 })

    expect(events.some((event) => event.type === 'PINCH_START')).toBe(false)
    expect(events.filter((event) => event.type === 'FIST')).toHaveLength(1)
  })

  it('uses the short pinch cooldown even when the burst cooldown is long', () => {
    const eventBus = new GestureEventBus()
    const coordinator = new GestureCoordinator(eventBus)
    const events: GestureEvent[] = []
    eventBus.subscribe((event) => events.push(event))

    for (const [timestamp, pinch] of [[0, 1], [100, 1], [140, 0], [250, 0], [450, 1], [550, 1]] as const) {
      coordinator.process(createFrame(timestamp, pinch), { sensitivity: 0.85, cooldownMs: 720 })
    }

    expect(events.filter((event) => event.type === 'PINCH_START')).toHaveLength(2)
  })

  it('activates a practical pinch score at the default sensitivity', () => {
    const eventBus = new GestureEventBus()
    const coordinator = new GestureCoordinator(eventBus)
    const events: GestureEvent[] = []
    eventBus.subscribe((event) => events.push(event))

    coordinator.process(createFrame(0, 0.66), { sensitivity: 0.58, cooldownMs: 720 })
    coordinator.process(createFrame(70, 0.66), { sensitivity: 0.58, cooldownMs: 720 })

    expect(events.some((event) => event.type === 'PINCH_START')).toBe(true)
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

  it('requires a deliberate stable hold before starting the dual circle', () => {
    const eventBus = new GestureEventBus()
    const coordinator = new GestureCoordinator(eventBus)
    const events: GestureEvent[] = []
    eventBus.subscribe((event) => events.push(event))

    coordinator.process(createDualFrame(0, 0.35, 0), { sensitivity: 0.58, cooldownMs: 10 })
    coordinator.process(createDualFrame(120, 0.35, 0), { sensitivity: 0.58, cooldownMs: 10 })
    expect(events.some((event) => event.type === 'TWO_HAND_CHARGE_START')).toBe(false)

    coordinator.process(createDualFrame(135, 0.35, 0), { sensitivity: 0.58, cooldownMs: 10 })
    expect(events.filter((event) => event.type === 'TWO_HAND_CHARGE_START')).toHaveLength(1)
  })

  it('restarts the entry hold after a long candidate interruption', () => {
    const eventBus = new GestureEventBus()
    const coordinator = new GestureCoordinator(eventBus)
    const events: GestureEvent[] = []
    eventBus.subscribe((event) => events.push(event))
    const frames = [
      createDualFrame(0, 0.35, 0),
      createDualFrame(40, 0.35, 0),
      createDualFrame(50, 0.35, 0),
      createDualFrame(140, 0.35, 0),
      createDualFrame(150, 0.35, 0),
      createDualFrame(270, 0.35, 0),
      createDualFrame(285, 0.35, 0),
    ]
    if (frames[2].twoHand) frames[2].twoHand.ready = false
    if (frames[3].twoHand) frames[3].twoHand.ready = false

    for (const frame of frames.slice(0, -1)) {
      coordinator.process(frame, { sensitivity: 0.58, cooldownMs: 10 })
    }
    expect(events.some((event) => event.type === 'TWO_HAND_CHARGE_START')).toBe(false)

    coordinator.process(frames.at(-1)!, { sensitivity: 0.58, cooldownMs: 10 })
    expect(events.filter((event) => event.type === 'TWO_HAND_CHARGE_START')).toHaveLength(1)
  })

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

  it('does not accumulate a release while the candidate pose is invalid', () => {
    const eventBus = new GestureEventBus()
    const coordinator = new GestureCoordinator(eventBus)
    const events: GestureEvent[] = []
    eventBus.subscribe((event) => events.push(event))
    const frames = [
      createDualFrame(0, 0.36, 0),
      createDualFrame(40, 0.25, -2.75),
      createDualFrame(120, 0.22, -0.38),
      createDualFrame(160, 0.31, 2.25),
      createDualFrame(190, 0.34, 1),
    ]
    if (frames[2].twoHand) frames[2].twoHand.ready = false
    if (frames[3].twoHand) frames[3].twoHand.ready = false

    for (const frame of frames) coordinator.process(frame, { sensitivity: 0.58, cooldownMs: 10 })

    expect(events.some((event) => event.type === 'TWO_HAND_RELEASE')).toBe(false)
  })
})
