import { GESTURE_CONFIG } from '../config/gestureConfig'
import type { GesturePose, HandGestureSnapshot } from '../types/gesture'
import type { HandFrame, Handedness, TrackedHand } from '../types/hand'
import { saturate } from '../utils/math'
import { GestureEventBus } from './GestureEventBus'
import { GestureStateMachine, type GestureStateUpdate } from './GestureStateMachine'

export interface GestureProcessOptions {
  sensitivity?: number
  cooldownMs?: number
}

interface HandMachines {
  open: GestureStateMachine
  fist: GestureStateMachine
  pinch: GestureStateMachine
  lastHand: TrackedHand | null
  lostEmitted: boolean
}

const HANDEDNESSES: readonly Handedness[] = ['left', 'right']

const createHandMachines = (): HandMachines => ({
  open: new GestureStateMachine({ ...GESTURE_CONFIG.open }),
  fist: new GestureStateMachine({ ...GESTURE_CONFIG.fist }),
  pinch: new GestureStateMachine({ ...GESTURE_CONFIG.pinch }),
  lastHand: null,
  lostEmitted: false,
})

const gesturePose = (hand: TrackedHand): GesturePose => ({
  position: hand.palm.center,
  width: hand.palm.width,
  rotation: hand.palm.rotation,
  normal: hand.palm.normal,
  confidence: hand.trackingQuality,
})

export class GestureCoordinator {
  private readonly eventBus: GestureEventBus
  private readonly hands: Record<Handedness, HandMachines> = {
    left: createHandMachines(),
    right: createHandMachines(),
  }
  private readonly twoHand = new GestureStateMachine({ ...GESTURE_CONFIG.twoHand })
  private snapshots: HandGestureSnapshot[] = []

  constructor(eventBus: GestureEventBus) {
    this.eventBus = eventBus
  }

  process(frame: HandFrame, options: GestureProcessOptions = {}): HandGestureSnapshot[] {
    const sensitivity = options.sensitivity ?? 0.58
    const cooldownMs = options.cooldownMs
    const nextSnapshots: HandGestureSnapshot[] = []

    for (const handedness of HANDEDNESSES) {
      const machines = this.hands[handedness]
      const current = frame.hands.find((hand) => hand.handedness === handedness) ?? null
      if (current) machines.lastHand = current
      const hand = current ?? machines.lastHand
      const ageMs = hand ? Math.max(0, frame.timestamp - hand.seenAt) : Number.POSITIVE_INFINITY
      const present = current !== null && ageMs <= GESTURE_CONFIG.loss.holdMs
      const confidence = present && hand ? hand.trackingQuality : 0

      const openUpdate = machines.open.update({
        timestamp: frame.timestamp,
        score: hand?.scores.open ?? 0,
        confidence,
        present,
        sensitivity,
        cooldownMs,
      })
      const fistUpdate = machines.fist.update({
        timestamp: frame.timestamp,
        score: hand?.scores.fist ?? 0,
        confidence,
        present,
        sensitivity,
        cooldownMs,
      })
      const pinchUpdate = machines.pinch.update({
        timestamp: frame.timestamp,
        score: hand?.scores.pinch ?? 0,
        confidence,
        present,
        sensitivity,
        cooldownMs,
      })

      if (hand) {
        this.emitHandEvents(hand, openUpdate, fistUpdate, pinchUpdate)
        if (present) machines.lostEmitted = false
        else if (ageMs >= GESTURE_CONFIG.loss.holdMs && !machines.lostEmitted) {
          this.eventBus.emit({ type: 'HAND_LOST', hand: handedness })
          machines.lostEmitted = true
        }

        if (ageMs <= GESTURE_CONFIG.loss.hideMs) {
          nextSnapshots.push({
            hand,
            openPhase: machines.open.phase,
            fistPhase: machines.fist.phase,
            pinchPhase: machines.pinch.phase,
          })
        } else {
          machines.lastHand = null
        }
      }
    }

    this.processTwoHand(frame, sensitivity, cooldownMs)
    this.snapshots = nextSnapshots
    return this.getSnapshots()
  }

  getSnapshots(): HandGestureSnapshot[] {
    return this.snapshots.map((snapshot) => ({ ...snapshot }))
  }

  reset(): void {
    for (const handedness of HANDEDNESSES) {
      const machines = this.hands[handedness]
      machines.open.reset()
      machines.fist.reset()
      machines.pinch.reset()
      machines.lastHand = null
      machines.lostEmitted = false
    }
    this.twoHand.reset()
    this.snapshots = []
  }

  private emitHandEvents(
    hand: TrackedHand,
    open: GestureStateUpdate,
    fist: GestureStateUpdate,
    pinch: GestureStateUpdate,
  ): void {
    const pose = gesturePose(hand)
    if (open.activated) this.eventBus.emit({ type: 'PALM_OPEN', hand: hand.handedness, pose })
    if (open.phase === 'active') this.eventBus.emit({ type: 'PALM_UPDATE', hand: hand.handedness, pose })
    if (open.released) this.eventBus.emit({ type: 'PALM_CLOSE', hand: hand.handedness })

    if (fist.activated) {
      this.eventBus.emit({
        type: 'FIST',
        hand: hand.handedness,
        pose,
        intensity: saturate(hand.scores.fist + hand.speed * 0.28),
      })
    }

    const pinchPosition = hand.landmarks[8] ?? hand.palm.center
    if (pinch.activated) this.eventBus.emit({ type: 'PINCH_START', hand: hand.handedness, position: pinchPosition })
    if (pinch.phase === 'active') this.eventBus.emit({ type: 'PINCH_MOVE', hand: hand.handedness, position: pinchPosition })
    if (pinch.released) this.eventBus.emit({ type: 'PINCH_END', hand: hand.handedness })
  }

  private processTwoHand(
    frame: HandFrame,
    sensitivity: number,
    cooldownMs: number | undefined,
  ): void {
    const metric = frame.twoHand
    const left = frame.hands.find((hand) => hand.handedness === 'left')
    const right = frame.hands.find((hand) => hand.handedness === 'right')
    const bothFresh = Boolean(
      left && right &&
      frame.timestamp - left.seenAt <= GESTURE_CONFIG.loss.holdMs &&
      frame.timestamp - right.seenAt <= GESTURE_CONFIG.loss.holdMs,
    )
    const bothOpen = left && right ? Math.min(left.scores.open, right.scores.open) : 0
    const distanceReady = metric
      ? metric.distance >= GESTURE_CONFIG.twoHand.minDistance && metric.distance <= GESTURE_CONFIG.twoHand.maxDistance
      : false
    const score = metric && distanceReady && metric.ready
      ? saturate(bothOpen * 0.58 + metric.oppositionScore * 0.42)
      : 0
    const confidence = left && right ? Math.min(left.trackingQuality, right.trackingQuality) : 0

    const update = this.twoHand.update({
      timestamp: frame.timestamp,
      score,
      confidence,
      present: Boolean(metric && bothFresh),
      sensitivity,
      cooldownMs,
    })

    if (metric && update.activated) {
      this.eventBus.emit({ type: 'TWO_HAND_CHARGE_START', center: metric.center, distance: metric.distance })
    }

    if (metric && update.phase === 'active') {
      this.eventBus.emit({
        type: 'TWO_HAND_CHARGE_UPDATE',
        center: metric.center,
        distance: metric.distance,
        velocity: metric.distanceVelocity,
      })

      if (metric.distanceVelocity >= GESTURE_CONFIG.twoHand.releaseVelocity) {
        this.eventBus.emit({ type: 'TWO_HAND_RELEASE', center: metric.center, velocity: metric.distanceVelocity })
        const forced = this.twoHand.forceRelease(frame.timestamp, cooldownMs)
        if (forced.released) this.eventBus.emit({ type: 'TWO_HAND_CHARGE_END' })
        return
      }
    }

    if (update.released) this.eventBus.emit({ type: 'TWO_HAND_CHARGE_END' })
  }
}
