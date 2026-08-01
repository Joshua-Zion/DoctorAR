import {
  FilesetResolver,
  HandLandmarker,
  type Category,
  type HandLandmarkerResult,
} from '@mediapipe/tasks-vision'
import { GESTURE_CONFIG, HAND_TRACKER_CONFIG } from '../config/gestureConfig'
import type {
  HandFrame,
  HandLandmark,
  Handedness,
  TrackedHand,
  TwoHandMetrics,
  Vector2Like,
} from '../types/hand'
import { clamp, inverseLerp, saturate } from '../utils/math'
import { CoordinateMapper } from './CoordinateMapper'
import { GestureRecognizer } from './GestureRecognizer'
import { HAND_LANDMARK, getPalmCenter, isValidHandLandmarks } from './HandLandmarks'
import { ExponentialLandmarkFilter } from './filters/ExponentialLandmarkFilter'

export interface HandTrackerOptions {
  mirrored?: boolean
  inputIsMirrored?: boolean
  delegate?: 'GPU' | 'CPU'
  modelPath?: string
  wasmPath?: string
  useWasmModule?: boolean
}

interface DetectionCandidate {
  landmarks: HandLandmark[]
  worldLandmarks: HandLandmark[]
  reportedHandedness: Handedness | null
  reportedConfidence: number
  center: Vector2Like
}

interface AssignedCandidate extends DetectionCandidate {
  handedness: Handedness
  handednessConfidence: number
}

const HANDEDNESSES: readonly Handedness[] = ['left', 'right']

const toLandmark = (landmark: { x: number; y: number; z: number; visibility?: number }): HandLandmark => ({
  x: landmark.x,
  y: landmark.y,
  z: landmark.z,
  ...(Number.isFinite(landmark.visibility) ? { visibility: landmark.visibility } : {}),
})

const opposite = (handedness: Handedness): Handedness => handedness === 'left' ? 'right' : 'left'

export class HandTracker {
  private handLandmarker: HandLandmarker | null
  private readonly mapper: CoordinateMapper
  private readonly recognizer: GestureRecognizer
  private readonly normalizedFilter = new ExponentialLandmarkFilter()
  private readonly worldFilter = new ExponentialLandmarkFilter()
  private readonly previousHands = new Map<Handedness, TrackedHand>()
  private previousTwoHand: TwoHandMetrics | null = null
  private lastTimestamp = -1
  private readonly inputIsMirrored: boolean

  private constructor(handLandmarker: HandLandmarker, options: HandTrackerOptions) {
    this.handLandmarker = handLandmarker
    this.mapper = new CoordinateMapper({ mirrored: options.mirrored ?? true })
    this.recognizer = new GestureRecognizer(this.mapper)
    this.inputIsMirrored = options.inputIsMirrored ?? false
  }

  static async create(options: HandTrackerOptions = {}): Promise<HandTracker> {
    const wasmFileset = await FilesetResolver.forVisionTasks(
      options.wasmPath ?? HAND_TRACKER_CONFIG.wasmPath,
      options.useWasmModule,
    )
    const requestedDelegate = options.delegate ?? 'GPU'
    const createWithDelegate = (delegate: 'GPU' | 'CPU'): Promise<HandLandmarker> => HandLandmarker.createFromOptions(wasmFileset, {
      baseOptions: {
        modelAssetPath: options.modelPath ?? HAND_TRACKER_CONFIG.modelPath,
        delegate,
      },
      runningMode: 'VIDEO',
      numHands: HAND_TRACKER_CONFIG.numHands,
      minHandDetectionConfidence: HAND_TRACKER_CONFIG.minHandDetectionConfidence,
      minHandPresenceConfidence: HAND_TRACKER_CONFIG.minHandPresenceConfidence,
      minTrackingConfidence: HAND_TRACKER_CONFIG.minTrackingConfidence,
    })

    try {
      return new HandTracker(await createWithDelegate(requestedDelegate), options)
    } catch (gpuError) {
      if (requestedDelegate === 'CPU') throw gpuError
      console.warn('MediaPipe GPU delegate unavailable; falling back to CPU.', gpuError)
      return new HandTracker(await createWithDelegate('CPU'), options)
    }
  }

  get ready(): boolean {
    return this.handLandmarker !== null
  }

  get coordinateMapper(): CoordinateMapper {
    return this.mapper
  }

  detect(
    video: HTMLVideoElement,
    timestampMs: number,
    smoothing = 0.68,
    sensitivity = 0.58,
  ): HandFrame {
    const videoWidth = Math.max(1, video.videoWidth || video.clientWidth || 1)
    const videoHeight = Math.max(1, video.videoHeight || video.clientHeight || 1)
    return this.detectSource(video, timestampMs, videoWidth, videoHeight, smoothing, sensitivity)
  }

  detectSource(
    source: TexImageSource,
    timestampMs: number,
    sourceWidth: number,
    sourceHeight: number,
    smoothing = 0.68,
    sensitivity = 0.58,
  ): HandFrame {
    const landmarker = this.handLandmarker
    if (!landmarker) throw new Error('HandTracker has been disposed')

    const timestamp = this.normalizeTimestamp(timestampMs)
    const videoWidth = Math.max(1, sourceWidth)
    const videoHeight = Math.max(1, sourceHeight)
    this.mapper.setVideoSize(videoWidth, videoHeight)
    this.normalizedFilter.setSmoothing(smoothing)
    this.worldFilter.setSmoothing(smoothing)

    const inferenceStarted = performance.now()
    const result = landmarker.detectForVideo(source, timestamp)
    const inferenceMs = performance.now() - inferenceStarted
    const candidates = this.readCandidates(result)
    const assigned = this.assignHandedness(candidates, timestamp)
    const detectedHands = assigned.map((candidate) => this.buildTrackedHand(candidate, timestamp, sensitivity))
    const detectedSides = new Set(detectedHands.map((hand) => hand.handedness))
    const hands = [...detectedHands]

    for (const handedness of HANDEDNESSES) {
      if (detectedSides.has(handedness)) continue
      const held = this.makeHeldHand(handedness, timestamp)
      if (held) hands.push(held)
    }

    hands.sort((a, b) => HANDEDNESSES.indexOf(a.handedness) - HANDEDNESSES.indexOf(b.handedness))
    let twoHand = this.recognizer.computeTwoHandMetrics(hands, this.previousTwoHand, timestamp)
    const allFresh = hands.length === 2 && hands.every((hand) => Math.abs(timestamp - hand.seenAt) < 0.5)
    if (twoHand && !allFresh) twoHand = { ...twoHand, ready: false }
    this.previousTwoHand = twoHand

    return {
      hands,
      twoHand,
      timestamp,
      inferenceMs,
      videoWidth,
      videoHeight,
    }
  }

  detectForVideo(
    video: HTMLVideoElement,
    timestampMs: number,
    smoothing = 0.68,
    sensitivity = 0.58,
  ): HandFrame {
    return this.detect(video, timestampMs, smoothing, sensitivity)
  }

  setMirrored(mirrored: boolean): void {
    if (mirrored === this.mapper.mirrored) return
    this.mapper.setMirrored(mirrored)
    this.reset()
  }

  reset(): void {
    this.normalizedFilter.reset()
    this.worldFilter.reset()
    this.recognizer.reset()
    this.previousHands.clear()
    this.previousTwoHand = null
  }

  dispose(): void {
    this.handLandmarker?.close()
    this.handLandmarker = null
    this.reset()
  }

  close(): void {
    this.dispose()
  }

  private normalizeTimestamp(timestampMs: number): number {
    const candidate = Number.isFinite(timestampMs) ? timestampMs : performance.now()
    const timestamp = this.lastTimestamp < 0 ? candidate : Math.max(candidate, this.lastTimestamp + 0.001)
    this.lastTimestamp = timestamp
    return timestamp
  }

  private readCandidates(result: HandLandmarkerResult): DetectionCandidate[] {
    return result.landmarks.slice(0, HAND_TRACKER_CONFIG.numHands).flatMap((sourceLandmarks, index) => {
      const mappedLandmarks = this.mapper.mapNormalizedList(sourceLandmarks.map(toLandmark))
      if (!isValidHandLandmarks(mappedLandmarks)) return []
      const sourceWorld = result.worldLandmarks[index] ?? []
      const worldLandmarks = this.mapper.mapWorldList(sourceWorld.map(toLandmark))
      const category = result.handedness[index]?.[0] ?? result.handednesses[index]?.[0]
      const reportedHandedness = this.readReportedHandedness(category)
      return [{
        landmarks: mappedLandmarks,
        worldLandmarks,
        reportedHandedness,
        reportedConfidence: saturate(category?.score ?? 0.5),
        center: getPalmCenter(mappedLandmarks),
      }]
    })
  }

  private readReportedHandedness(category: Category | undefined): Handedness | null {
    const label = category?.categoryName.toLowerCase()
    let handedness: Handedness | null = label?.includes('left')
      ? 'left'
      : label?.includes('right')
        ? 'right'
        : null
    if (handedness && !this.inputIsMirrored) handedness = opposite(handedness)
    return handedness
  }

  private assignHandedness(candidates: readonly DetectionCandidate[], timestamp: number): AssignedCandidate[] {
    if (candidates.length === 0) return []
    if (candidates.length === 1) {
      const candidate = candidates[0]
      const handedness = [...HANDEDNESSES].sort(
        (a, b) => this.assignmentCost(candidate, a, timestamp) - this.assignmentCost(candidate, b, timestamp),
      )[0]
      return [this.withAssignment(candidate, handedness)]
    }

    const first = candidates[0]
    const second = candidates[1]
    const directCost = this.assignmentCost(first, 'left', timestamp) + this.assignmentCost(second, 'right', timestamp)
    const swappedCost = this.assignmentCost(first, 'right', timestamp) + this.assignmentCost(second, 'left', timestamp)
    return directCost <= swappedCost
      ? [this.withAssignment(first, 'left'), this.withAssignment(second, 'right')]
      : [this.withAssignment(first, 'right'), this.withAssignment(second, 'left')]
  }

  private withAssignment(candidate: DetectionCandidate, handedness: Handedness): AssignedCandidate {
    const agrees = candidate.reportedHandedness === null || candidate.reportedHandedness === handedness
    return {
      ...candidate,
      handedness,
      handednessConfidence: agrees ? candidate.reportedConfidence : 1 - candidate.reportedConfidence,
    }
  }

  private assignmentCost(candidate: DetectionCandidate, handedness: Handedness, timestamp: number): number {
    const labelCost = candidate.reportedHandedness === null
      ? 0.25
      : candidate.reportedHandedness === handedness
        ? (1 - candidate.reportedConfidence) * 0.3
        : 0.7 + candidate.reportedConfidence * 0.55
    const previous = this.previousHands.get(handedness)
    if (previous && timestamp - previous.seenAt <= GESTURE_CONFIG.loss.hideMs) {
      return labelCost + this.mapper.distance(previous.palm.center, candidate.center) * 3.2
    }

    const expectedX = handedness === 'left'
      ? (this.mapper.mirrored ? 0.28 : 0.72)
      : (this.mapper.mirrored ? 0.72 : 0.28)
    return labelCost + Math.abs(candidate.center.x - expectedX) * 0.16
  }

  private buildTrackedHand(candidate: AssignedCandidate, timestamp: number, sensitivity: number): TrackedHand {
    const key = candidate.handedness
    const landmarks = this.normalizedFilter.filter(`${key}:normalized`, candidate.landmarks, timestamp)
    const worldLandmarks = isValidHandLandmarks(candidate.worldLandmarks)
      ? this.worldFilter.filter(`${key}:world`, candidate.worldLandmarks, timestamp)
      : []
    const center = getPalmCenter(landmarks)
    const previous = this.previousHands.get(key)
    const elapsedSeconds = previous && timestamp > previous.seenAt ? (timestamp - previous.seenAt) / 1000 : 0
    let velocity: Vector2Like = { x: 0, y: 0 }
    if (previous && elapsedSeconds > 0 && elapsedSeconds <= GESTURE_CONFIG.loss.hideMs / 1000) {
      velocity = {
        x: (center.x - previous.palm.center.x) / elapsedSeconds,
        y: (center.y - previous.palm.center.y) / elapsedSeconds,
      }
    }
    const trackingQuality = this.estimateTrackingQuality(landmarks, previous)
    const hand = this.recognizer.recognizeHand({
      handedness: key,
      handednessConfidence: candidate.handednessConfidence,
      trackingQuality,
      landmarks,
      worldLandmarks,
      velocity,
      seenAt: timestamp,
      sensitivity,
    })
    this.previousHands.set(key, hand)
    return hand
  }

  private estimateTrackingQuality(landmarks: readonly HandLandmark[], previous: TrackedHand | undefined): number {
    const palmWidth = this.mapper.distance(
      landmarks[HAND_LANDMARK.INDEX_MCP],
      landmarks[HAND_LANDMARK.PINKY_MCP],
    )
    const minimumSize = inverseLerp(0.018, 0.055, palmWidth)
    const maximumSize = 1 - inverseLerp(0.34, 0.5, palmWidth)
    const spanQuality = saturate(minimumSize * maximumSize)
    const center = getPalmCenter(landmarks)
    const continuity = previous
      ? 1 - inverseLerp(0.12, 0.48, this.mapper.distance(previous.palm.center, center))
      : 0.82
    return saturate(0.62 + spanQuality * 0.27 + continuity * 0.11)
  }

  private makeHeldHand(handedness: Handedness, timestamp: number): TrackedHand | null {
    const previous = this.previousHands.get(handedness)
    if (!previous) return null
    const ageMs = timestamp - previous.seenAt
    if (ageMs > GESTURE_CONFIG.loss.hideMs) {
      this.previousHands.delete(handedness)
      this.normalizedFilter.reset(`${handedness}:normalized`)
      this.worldFilter.reset(`${handedness}:world`)
      this.recognizer.reset(handedness)
      return null
    }

    const fadeProgress = inverseLerp(
      GESTURE_CONFIG.loss.holdMs,
      GESTURE_CONFIG.loss.holdMs + GESTURE_CONFIG.loss.fadeMs,
      ageMs,
    )
    const velocityRetention = clamp(1 - ageMs / Math.max(1, GESTURE_CONFIG.loss.hideMs), 0, 1)
    return {
      ...previous,
      trackingQuality: previous.trackingQuality * (1 - fadeProgress),
      velocity: {
        x: previous.velocity.x * velocityRetention,
        y: previous.velocity.y * velocityRetention,
      },
      speed: previous.speed * velocityRetention,
    }
  }
}
