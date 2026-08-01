import { GESTURE_CONFIG } from '../config/gestureConfig'
import type {
  FingerName,
  FingerPoses,
  GestureLabel,
  GestureScores,
  HandLandmark,
  Handedness,
  PalmMetrics,
  TrackedHand,
  TwoHandMetrics,
  Vector2Like,
  Vector3Like,
} from '../types/hand'
import { clamp, inverseLerp, saturate } from '../utils/math'
import { angleAt, cross3, distance3, dot3, midpoint3, normalize3, subtract3 } from '../utils/vector'
import { CoordinateMapper } from './CoordinateMapper'
import { FINGER_CHAINS, HAND_LANDMARK, getKnuckleCenter, getPalmCenter, isValidHandLandmarks } from './HandLandmarks'

export interface RecognizeHandInput {
  handedness: Handedness
  handednessConfidence: number
  trackingQuality: number
  landmarks: HandLandmark[]
  worldLandmarks: HandLandmark[]
  velocity: Vector2Like
  seenAt: number
  sensitivity?: number
}

interface FingerHysteresis {
  thumb: boolean
  index: boolean
  middle: boolean
  ring: boolean
  pinky: boolean
}

const FINGER_NAMES: readonly FingerName[] = ['thumb', 'index', 'middle', 'ring', 'pinky']
const EXTEND_ENTER = 0.72
const EXTEND_EXIT = 0.52

const mean = (values: readonly number[]): number =>
  values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length

export const getHandExtensionScore = (hand: TrackedHand): number => saturate((
  4 -
  hand.fingers.index.curl -
  hand.fingers.middle.curl -
  hand.fingers.ring.curl -
  hand.fingers.pinky.curl
) * 0.25)

const negate = (value: Vector3Like): Vector3Like => ({ x: -value.x, y: -value.y, z: -value.z })

const scale = (value: Vector3Like, amount: number): Vector3Like => ({
  x: value.x * amount,
  y: value.y * amount,
  z: value.z * amount,
})

const asGeometryLandmarks = (
  normalized: readonly HandLandmark[],
  world: readonly HandLandmark[],
  mapper: CoordinateMapper,
): readonly HandLandmark[] => {
  if (isValidHandLandmarks(world)) return world
  return normalized.map((landmark) => mapper.toAspectCorrected3(landmark))
}

export class GestureRecognizer {
  private readonly extensionState = new Map<Handedness, FingerHysteresis>()
  private readonly mapper: CoordinateMapper
  private previousTwoHandTimestamp = 0

  constructor(mapper: CoordinateMapper) {
    this.mapper = mapper
  }

  recognizeHand(input: RecognizeHandInput): TrackedHand {
    const geometry = asGeometryLandmarks(input.landmarks, input.worldLandmarks, this.mapper)
    const palm = this.computePalm(input.handedness, input.landmarks, geometry)
    const fingers = this.computeFingers(input.handedness, geometry)
    const scores = this.computeScores(input.landmarks, fingers, palm)
    const gesture = this.pickGesture(scores, input.sensitivity ?? 1)

    return {
      handedness: input.handedness,
      handednessConfidence: saturate(input.handednessConfidence),
      trackingQuality: saturate(input.trackingQuality),
      landmarks: input.landmarks,
      worldLandmarks: input.worldLandmarks,
      palm,
      fingers,
      scores,
      gesture,
      velocity: input.velocity,
      speed: this.mapper.speed(input.velocity),
      seenAt: input.seenAt,
    }
  }

  computeTwoHandMetrics(hands: readonly TrackedHand[], previous: TwoHandMetrics | null, timestampMs: number): TwoHandMetrics | null {
    const left = hands.find((hand) => hand.handedness === 'left')
    const right = hands.find((hand) => hand.handedness === 'right')
    if (!left || !right) return null

    const center = midpoint3(left.palm.center, right.palm.center)
    const distance = this.mapper.distance(left.palm.center, right.palm.center)
    const elapsed = previous && timestampMs > this.previousTwoHandTimestamp
      ? (timestampMs - this.previousTwoHandTimestamp) / 1000
      : 0
    const distanceVelocity = previous && elapsed > 0 ? (distance - previous.distance) / elapsed : 0
    this.previousTwoHandTimestamp = timestampMs
    const inwardFacingScore = saturate((1 - dot3(left.palm.normal, right.palm.normal)) * 0.5)
    const cameraFacingScore = Math.min(left.palm.facingScore, right.palm.facingScore)
    // Two palms may either face each other or remain angled toward the camera.
    // Keep the downstream field name for compatibility, but make it represent
    // the strongest supported two-hand orientation instead of opposition only.
    const oppositionScore = Math.max(inwardFacingScore, cameraFacingScore)
    const bothLongFingersOpen = Math.min(getHandExtensionScore(left), getHandExtensionScore(right))
    const distanceReady = distance >= GESTURE_CONFIG.twoHand.minDistance &&
      distance <= GESTURE_CONFIG.twoHand.maxDistance

    return {
      center,
      distance,
      distanceVelocity,
      oppositionScore,
      ready:
        distanceReady &&
        bothLongFingersOpen >= GESTURE_CONFIG.twoHand.longFingerScore &&
        oppositionScore >= GESTURE_CONFIG.twoHand.orientationScore,
    }
  }

  reset(handedness?: Handedness): void {
    if (handedness) this.extensionState.delete(handedness)
    else {
      this.extensionState.clear()
      this.previousTwoHandTimestamp = 0
    }
  }

  private computePalm(
    handedness: Handedness,
    normalized: readonly HandLandmark[],
    geometry: readonly HandLandmark[],
  ): PalmMetrics {
    const center = getPalmCenter(normalized)
    const index = geometry[HAND_LANDMARK.INDEX_MCP]
    const pinky = geometry[HAND_LANDMARK.PINKY_MCP]
    const wrist = geometry[HAND_LANDMARK.WRIST]
    const knuckleCenter = getKnuckleCenter(geometry)
    const across = normalize3(subtract3(index, pinky))
    const wristToKnuckles = subtract3(knuckleCenter, wrist)
    const along = normalize3(subtract3(wristToKnuckles, scale(across, dot3(wristToKnuckles, across))))
    let normal = normalize3(cross3(across, along))
    const anatomicalSign = (handedness === 'left' ? 1 : -1) * (this.mapper.mirrored ? -1 : 1)
    if (anatomicalSign < 0) normal = negate(normal)

    const facingScore = saturate(inverseLerp(0.08, 0.82, -normal.z))
    const width = this.mapper.distance(normalized[HAND_LANDMARK.INDEX_MCP], normalized[HAND_LANDMARK.PINKY_MCP])
    const rotationVector = this.mapper.aspectVector(
      normalized[HAND_LANDMARK.PINKY_MCP],
      normalized[HAND_LANDMARK.INDEX_MCP],
    )

    return {
      center,
      width,
      rotation: Math.atan2(rotationVector.y, rotationVector.x),
      normal,
      facingScore,
      facesCamera:
        facingScore >= GESTURE_CONFIG.palm.facingThreshold &&
        width >= GESTURE_CONFIG.palm.minWidth &&
        width <= GESTURE_CONFIG.palm.maxWidth,
    }
  }

  private computeFingers(handedness: Handedness, geometry: readonly HandLandmark[]): FingerPoses {
    const previous = this.extensionState.get(handedness) ?? {
      thumb: false,
      index: false,
      middle: false,
      ring: false,
      pinky: false,
    }
    const next = { ...previous }
    const palmScale = Math.max(
      distance3(geometry[HAND_LANDMARK.INDEX_MCP], geometry[HAND_LANDMARK.PINKY_MCP]),
      1e-4,
    )
    const poses = {} as FingerPoses

    for (const name of FINGER_NAMES) {
      const [baseIndex, firstIndex, secondIndex, tipIndex] = FINGER_CHAINS[name]
      const base = geometry[baseIndex]
      const first = geometry[firstIndex]
      const second = geometry[secondIndex]
      const tip = geometry[tipIndex]
      const firstAngle = angleAt(base, first, second)
      const secondAngle = angleAt(first, second, tip)
      const angleScore = inverseLerp((name === 'thumb' ? 118 : 132) * Math.PI / 180, 168 * Math.PI / 180, Math.min(firstAngle, secondAngle))
      const reach = (distance3(tip, geometry[HAND_LANDMARK.WRIST]) - distance3(first, geometry[HAND_LANDMARK.WRIST])) / palmScale
      const reachScore = inverseLerp(name === 'thumb' ? -0.08 : 0.05, name === 'thumb' ? 0.58 : 0.92, reach)
      const separationScore = name === 'thumb'
        ? inverseLerp(0.34, 0.86, distance3(tip, geometry[HAND_LANDMARK.INDEX_MCP]) / palmScale)
        : 1
      const extensionScore = saturate(angleScore * 0.68 + reachScore * 0.22 + separationScore * 0.1)
      next[name] = previous[name] ? extensionScore >= EXTEND_EXIT : extensionScore >= EXTEND_ENTER
      poses[name] = { extended: next[name], curl: 1 - extensionScore }
    }

    this.extensionState.set(handedness, next)
    return poses
  }

  private computeScores(landmarks: readonly HandLandmark[], fingers: FingerPoses, palm: PalmMetrics): GestureScores {
    const extensions = FINGER_NAMES.map((name) => 1 - fingers[name].curl)
    const curls = FINGER_NAMES.map((name) => fingers[name].curl)
    const longExtensions = (extensions[1] + extensions[2] + extensions[3] + extensions[4]) * 0.25
    const facingGate = palm.facesCamera ? 1 : 0.42
    const open = saturate(
      (longExtensions * 0.78 + extensions[0] * 0.22) *
      (0.68 + palm.facingScore * 0.32) *
      facingGate,
    )
    const fist = saturate(mean(curls) * (0.88 + (1 - palm.facingScore) * 0.12))
    const pinchDistance = this.mapper.distance(
      landmarks[HAND_LANDMARK.THUMB_TIP],
      landmarks[HAND_LANDMARK.INDEX_TIP],
    )
    const pinch = 1 - inverseLerp(0.2, 0.72, pinchDistance / Math.max(palm.width, 1e-4))
    return { open, fist, pinch: saturate(pinch) }
  }

  private pickGesture(scores: GestureScores, sensitivity: number): GestureLabel {
    const sensitivityScale = 0.75 + clamp(sensitivity, 0, 1) * 0.65
    const thresholdScale = clamp(1 / sensitivityScale, 0.72, 1.35)
    const candidates: Array<[GestureLabel, number, number]> = [
      ['pinch', scores.pinch, GESTURE_CONFIG.pinch.enterScore * thresholdScale],
      ['fist', scores.fist, GESTURE_CONFIG.fist.enterScore * thresholdScale],
      ['open', scores.open, GESTURE_CONFIG.open.enterScore * thresholdScale],
    ]
    const winner = candidates
      .filter(([, score, threshold]) => score >= threshold)
      .sort((a, b) => b[1] - a[1])[0]
    return winner?.[0] ?? 'neutral'
  }
}
