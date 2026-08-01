import { GESTURE_CONFIG } from '../config/gestureConfig'
import type { GesturePose, HandGestureSnapshot } from '../types/gesture'
import type { HandFrame, Handedness, TrackedHand } from '../types/hand'
import { saturate } from '../utils/math'
import { midpoint3 } from '../utils/vector'
import { GestureEventBus } from './GestureEventBus'
import { getHandExtensionScore } from './GestureRecognizer'
import { GestureStateMachine, type GestureStateUpdate } from './GestureStateMachine'
import { TwoHandReleaseDetector } from './TwoHandReleaseDetector'

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
  private readonly twoHandRelease = new TwoHandReleaseDetector({
    releaseVelocity: GESTURE_CONFIG.twoHand.releaseVelocity,
    cooldownMs: GESTURE_CONFIG.twoHand.cooldownMs,
  })
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
      })
      const pinchScore = hand?.scores.pinch ?? 0
      const fistScore = hand?.scores.fist ?? 0
      const pinchOwnsPose = pinchScore >= Math.max(0.52, fistScore - 0.08)
      const pinchUpdate = machines.pinch.update({
        timestamp: frame.timestamp,
        score: pinchOwnsPose ? pinchScore : 0,
        confidence,
        present,
        sensitivity,
      })
      const pinchClaimsHand = (
        pinchUpdate.phase === 'candidate' || pinchUpdate.phase === 'active'
      )
      const fistUpdate = machines.fist.update({
        timestamp: frame.timestamp,
        score: pinchClaimsHand ? 0 : hand?.scores.fist ?? 0,
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
    this.twoHandRelease.reset()
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
      const intensity = Math.min(1.65, Math.max(
        1.05,
        hand.scores.fist * 1.18 + hand.speed * 0.42,
      ))
      this.eventBus.emit({
        type: 'FIST',
        hand: hand.handedness,
        pose,
        intensity,
      })
    }

    const thumbTip = hand.landmarks[4] ?? hand.palm.center
    const indexTip = hand.landmarks[8] ?? hand.palm.center
    const pinchPosition = midpoint3(thumbTip, indexTip)
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
    const bothFreshForRelease = Boolean(
      left && right &&
      frame.timestamp - left.seenAt <= 60 &&
      frame.timestamp - right.seenAt <= 60,
    )
    const bothExtended = left && right
      ? Math.min(getHandExtensionScore(left), getHandExtensionScore(right))
      : 0
    const distanceReady = metric
      ? metric.distance >= GESTURE_CONFIG.twoHand.minDistance && metric.distance <= GESTURE_CONFIG.twoHand.maxDistance
      : false
    const score = metric && distanceReady && metric.ready
      ? saturate(bothExtended * 0.68 + metric.oppositionScore * 0.32)
      : 0
    const confidence = left && right ? Math.min(left.trackingQuality, right.trackingQuality) : 0

    const update = this.twoHand.update({
      timestamp: frame.timestamp,
      score,
      confidence,
      present: Boolean(metric && bothFresh),
      sensitivity,
    })

    const aspectY = frame.videoHeight / Math.max(1, frame.videoWidth)
    const axisX = left && right ? right.palm.center.x - left.palm.center.x : 0
    const axisY = left && right ? (right.palm.center.y - left.palm.center.y) * aspectY : 0
    const axisLength = Math.hypot(axisX, axisY)
    const relativeVelocityX = left && right ? right.velocity.x - left.velocity.x : 0
    const relativeVelocityY = left && right ? (right.velocity.y - left.velocity.y) * aspectY : 0
    const outwardVelocity = axisLength > 0.0001
      ? (relativeVelocityX * axisX + relativeVelocityY * axisY) / axisLength
      : 0

    const releaseObservationValid = Boolean(
      metric &&
      bothFreshForRelease &&
      (update.phase === 'active' || metric.ready)
    )
    const release = this.twoHandRelease.update({
      timestamp: frame.timestamp,
      distance: metric?.distance ?? 0,
      distanceVelocity: metric?.distanceVelocity,
      outwardVelocity,
      chargeActive: update.phase === 'candidate' || update.phase === 'active',
      releaseEnabled: update.phase === 'active',
      valid: releaseObservationValid,
      resetVelocityOnRecovery: !releaseObservationValid,
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

      if (release.triggered) {
        const forced = this.twoHand.forceRelease(frame.timestamp, cooldownMs)
        if (forced.released) this.eventBus.emit({ type: 'TWO_HAND_CHARGE_END' })
        this.eventBus.emit({ type: 'TWO_HAND_RELEASE', center: metric.center, velocity: release.filteredVelocity })
        return
      }
    }

    if (update.released) this.eventBus.emit({ type: 'TWO_HAND_CHARGE_END' })
  }
}
