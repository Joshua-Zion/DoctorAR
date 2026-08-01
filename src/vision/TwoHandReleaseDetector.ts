export type TwoHandReleasePhase = 'idle' | 'arming' | 'armed' | 'cooldown'

export interface TwoHandReleaseConfig {
  /** Maximum number of samples retained in the preallocated ring buffer. */
  capacity: number
  /** Only samples inside this interval contribute compression evidence. */
  historyWindowMs: number
  /** A sustained distance at or below this value can arm without an approach sample. */
  nearDistance: number
  /** Recent peak minus current distance required to prove an inward movement. */
  minCompressionDelta: number
  /** Compression/near-distance evidence must remain valid for this long. */
  armHoldMs: number
  /** Expansion above the armed minimum that starts the strict release window. */
  expansionStartDelta: number
  /** Maximum time allowed from expansion start to release. */
  releaseWindowMs: number
  /** Distance growth from the armed minimum required for release. */
  minExpansionDelta: number
  /** Minimum filtered outward distance velocity in normalized-width units/s. */
  releaseVelocity: number
  /** Time-based velocity smoothing half-life. */
  velocityHalfLifeMs: number
  /** Rejects reacquisition spikes before velocity smoothing. */
  maxAbsVelocity: number
  /** Delay after a trigger; a fresh arm sequence is required afterwards. */
  cooldownMs: number
  /** Invalid/inactive input may bridge this gap before the detector resets. */
  invalidResetMs: number
}

export const DEFAULT_TWO_HAND_RELEASE_CONFIG: Readonly<TwoHandReleaseConfig> = {
  capacity: 48,
  historyWindowMs: 420,
  nearDistance: 0.28,
  minCompressionDelta: 0.025,
  armHoldMs: 70,
  expansionStartDelta: 0.012,
  releaseWindowMs: 360,
  minExpansionDelta: 0.055,
  releaseVelocity: 0.5,
  velocityHalfLifeMs: 45,
  maxAbsVelocity: 4,
  cooldownMs: 260,
  invalidResetMs: 240,
}

export interface TwoHandReleaseSample {
  /** Monotonic source-frame timestamp in milliseconds. */
  timestamp: number
  /** Aspect-corrected distance in normalized image-width units. */
  distance: number
  /** Optional precomputed derivative; the detector derives it when omitted. */
  distanceVelocity?: number
  /** Optional relative velocity projected along the hand-to-hand axis. */
  outwardVelocity?: number
  /** True while the two-hand charge gesture is a candidate or active. */
  chargeActive: boolean
  /** True only after the charge state is active and a release may be emitted. */
  releaseEnabled?: boolean
  /** False for stale, held, or otherwise unreliable two-hand observations. */
  valid?: boolean
  /** Invalid samples with a likely pose/reacquisition jump reset velocity on recovery. */
  resetVelocityOnRecovery?: boolean
}

export interface TwoHandReleaseUpdate {
  phase: TwoHandReleasePhase
  triggered: boolean
  armedThisFrame: boolean
  disarmedThisFrame: boolean
  filteredVelocity: number
  expansion: number
  expansionElapsedMs: number
  cooldownRemainingMs: number
}

interface HistorySample {
  timestamp: number
  distance: number
}

const finiteOr = (value: number | undefined, fallback: number): number =>
  Number.isFinite(value) ? value as number : fallback

const RELEASE_QUALIFIED_HOLD_MS = 140

const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.min(maximum, Math.max(minimum, value))

const validateConfig = (partial: Partial<TwoHandReleaseConfig>): TwoHandReleaseConfig => {
  const merged = { ...DEFAULT_TWO_HAND_RELEASE_CONFIG, ...partial }
  return {
    capacity: Math.max(4, Math.floor(merged.capacity)),
    historyWindowMs: Math.max(1, merged.historyWindowMs),
    nearDistance: Math.max(0, merged.nearDistance),
    minCompressionDelta: Math.max(0, merged.minCompressionDelta),
    armHoldMs: Math.max(0, merged.armHoldMs),
    expansionStartDelta: Math.max(0, merged.expansionStartDelta),
    releaseWindowMs: Math.max(1, merged.releaseWindowMs),
    minExpansionDelta: Math.max(merged.expansionStartDelta, merged.minExpansionDelta),
    releaseVelocity: Math.max(0, merged.releaseVelocity),
    velocityHalfLifeMs: Math.max(1, merged.velocityHalfLifeMs),
    maxAbsVelocity: Math.max(0.01, merged.maxAbsVelocity),
    cooldownMs: Math.max(0, merged.cooldownMs),
    invalidResetMs: Math.max(0, merged.invalidResetMs),
  }
}

/**
 * Recognizes a strict "compress, then expand quickly" two-hand release.
 *
 * All thresholds are time- or distance-based. No transition depends on the
 * number of frames received, so skipped frames and different inference rates
 * produce the same behavior for the same timestamped movement.
 */
export class TwoHandReleaseDetector {
  private readonly config: TwoHandReleaseConfig
  private readonly history: Array<HistorySample | undefined>
  private historyHead = 0
  private historyCount = 0
  private phaseValue: TwoHandReleasePhase = 'idle'
  private lastTimestamp = Number.NEGATIVE_INFINITY
  private lastValidTimestamp = Number.NEGATIVE_INFINITY
  private lastChargeTimestamp = Number.NEGATIVE_INFINITY
  private lastDistance = 0
  private filteredVelocity = 0
  private armCandidateSince = Number.NaN
  private armCandidateMinimum = Number.POSITIVE_INFINITY
  private armedMinimum = Number.POSITIVE_INFINITY
  private expansionStartedAt = Number.NaN
  private releaseQualified = false
  private releaseQualifiedAt = Number.NaN
  private reacquisitionPending = false
  private cooldownUntil = Number.NEGATIVE_INFINITY

  constructor(config: Partial<TwoHandReleaseConfig> = {}) {
    this.config = validateConfig(config)
    this.history = new Array<HistorySample | undefined>(this.config.capacity)
  }

  get phase(): TwoHandReleasePhase {
    return this.phaseValue
  }

  get isArmed(): boolean {
    return this.phaseValue === 'armed'
  }

  update(sample: TwoHandReleaseSample): TwoHandReleaseUpdate {
    if (!Number.isFinite(sample.timestamp) || !Number.isFinite(sample.distance) || sample.distance < 0) {
      return this.result(false, false, false, finiteOr(sample.timestamp, this.lastTimestamp))
    }

    const timestamp = sample.timestamp
    if (timestamp <= this.lastTimestamp) return this.result(false, false, false, timestamp)

    this.lastTimestamp = timestamp

    if (this.phaseValue === 'cooldown' && timestamp >= this.cooldownUntil) {
      this.resetSequence('idle')
    }

    const observationValid = sample.valid ?? true
    if (!observationValid) {
      if (sample.resetVelocityOnRecovery) this.reacquisitionPending = true
      if (this.phaseValue === 'cooldown') return this.result(false, false, false, timestamp)
      const invalidForMs = timestamp - this.lastChargeTimestamp
      if (invalidForMs > this.config.invalidResetMs && this.phaseValue !== 'idle') {
        this.resetSequence('idle')
        return this.result(false, false, true, timestamp)
      }
      return this.result(false, false, false, timestamp)
    }

    const elapsedMs = Number.isFinite(this.lastValidTimestamp) ? timestamp - this.lastValidTimestamp : 0
    const requiresReacquisitionBaseline =
      this.reacquisitionPending ||
      elapsedMs >= this.config.invalidResetMs
    this.reacquisitionPending = false
    if (requiresReacquisitionBaseline) {
      this.lastDistance = sample.distance
      this.lastValidTimestamp = timestamp
      this.filteredVelocity = 0
      this.releaseQualified = false
      this.releaseQualifiedAt = Number.NaN
      this.expansionStartedAt = Number.NaN
      this.pushHistory({ timestamp, distance: sample.distance })
      if (sample.chargeActive) this.lastChargeTimestamp = timestamp
      return this.result(false, false, false, timestamp)
    }
    const derivedVelocity = elapsedMs > 0 ? (sample.distance - this.lastDistance) / (elapsedMs / 1000) : 0
    const suppliedVelocity = finiteOr(sample.distanceVelocity, derivedVelocity)
    const outwardVelocity = finiteOr(sample.outwardVelocity, suppliedVelocity)
    const conservativeVelocity = suppliedVelocity > 0 && outwardVelocity > 0
      ? suppliedVelocity * 0.65 + outwardVelocity * 0.35
      : Math.min(suppliedVelocity, outwardVelocity)
    const boundedVelocity = clamp(conservativeVelocity, -this.config.maxAbsVelocity, this.config.maxAbsVelocity)
    const smoothingAlpha = elapsedMs > 0
      ? 1 - Math.exp(-Math.LN2 * elapsedMs / this.config.velocityHalfLifeMs)
      : 1
    this.filteredVelocity += (boundedVelocity - this.filteredVelocity) * smoothingAlpha
    const recentPeak = this.recentPeakDistance(timestamp)
    this.pushHistory({ timestamp, distance: sample.distance })
    this.lastDistance = sample.distance
    this.lastValidTimestamp = timestamp

    if (this.phaseValue === 'cooldown') {
      return this.result(false, false, false, timestamp)
    }

    if (!sample.chargeActive) {
      const inactiveForMs = timestamp - this.lastChargeTimestamp
      if (inactiveForMs > this.config.invalidResetMs && this.phaseValue !== 'idle') {
        this.resetSequence('idle')
        return this.result(false, false, true, timestamp)
      }
      return this.result(false, false, false, timestamp)
    }

    this.lastChargeTimestamp = timestamp
    const releaseEnabled = sample.releaseEnabled ?? sample.chargeActive

    if (this.phaseValue === 'idle' || this.phaseValue === 'arming') {
      const compression = Math.max(0, recentPeak - sample.distance)
      const hasArmEvidence = sample.distance <= this.config.nearDistance || compression >= this.config.minCompressionDelta

      if (!hasArmEvidence) {
        const wasArming = this.phaseValue === 'arming'
        this.clearArmCandidate()
        this.phaseValue = 'idle'
        return this.result(false, false, wasArming, timestamp)
      }

      if (this.phaseValue === 'idle') {
        this.phaseValue = 'arming'
        this.armCandidateSince = timestamp
        this.armCandidateMinimum = sample.distance
      } else {
        this.armCandidateMinimum = Math.min(this.armCandidateMinimum, sample.distance)
      }

      if (timestamp - this.armCandidateSince >= this.config.armHoldMs) {
        this.phaseValue = 'armed'
        this.armedMinimum = Math.min(this.armCandidateMinimum, sample.distance)
        this.expansionStartedAt = Number.NaN
        this.releaseQualified = false
        this.releaseQualifiedAt = Number.NaN
        this.clearArmCandidate()
        return this.result(false, true, false, timestamp)
      }

      return this.result(false, false, false, timestamp)
    }

    return this.updateArmed(sample.distance, timestamp, releaseEnabled)
  }

  reset(): void {
    this.history.fill(undefined)
    this.historyHead = 0
    this.historyCount = 0
    this.phaseValue = 'idle'
    this.lastTimestamp = Number.NEGATIVE_INFINITY
    this.lastValidTimestamp = Number.NEGATIVE_INFINITY
    this.lastChargeTimestamp = Number.NEGATIVE_INFINITY
    this.lastDistance = 0
    this.filteredVelocity = 0
    this.clearArmCandidate()
    this.armedMinimum = Number.POSITIVE_INFINITY
    this.expansionStartedAt = Number.NaN
    this.releaseQualified = false
    this.releaseQualifiedAt = Number.NaN
    this.reacquisitionPending = false
    this.cooldownUntil = Number.NEGATIVE_INFINITY
  }

  private updateArmed(distance: number, timestamp: number, releaseEnabled: boolean): TwoHandReleaseUpdate {
    if (distance < this.armedMinimum) {
      this.armedMinimum = distance
      this.expansionStartedAt = Number.NaN
      this.releaseQualified = false
      this.releaseQualifiedAt = Number.NaN
    }

    const expansion = Math.max(0, distance - this.armedMinimum)
    if (!Number.isFinite(this.expansionStartedAt)) {
      if (expansion >= this.config.expansionStartDelta && this.filteredVelocity > 0) {
        this.expansionStartedAt = timestamp
      }
    }

    const expansionElapsedMs = Number.isFinite(this.expansionStartedAt)
      ? timestamp - this.expansionStartedAt
      : 0

    if (Number.isFinite(this.expansionStartedAt) && expansionElapsedMs > this.config.releaseWindowMs) {
      this.resetSequence('idle')
      return this.result(false, false, true, timestamp)
    }

    if (
      Number.isFinite(this.expansionStartedAt) &&
      expansion >= this.config.minExpansionDelta &&
      this.filteredVelocity >= this.config.releaseVelocity
    ) {
      this.releaseQualified = true
      this.releaseQualifiedAt = timestamp
    }

    if (
      this.releaseQualified &&
      timestamp - this.releaseQualifiedAt > RELEASE_QUALIFIED_HOLD_MS
    ) {
      this.releaseQualified = false
      this.releaseQualifiedAt = Number.NaN
    }

    if (
      this.releaseQualified &&
      releaseEnabled &&
      expansion >= this.config.minExpansionDelta
    ) {
      this.phaseValue = 'cooldown'
      this.cooldownUntil = timestamp + this.config.cooldownMs
      this.clearArmCandidate()
      this.expansionStartedAt = Number.NaN
      this.releaseQualified = false
      this.releaseQualifiedAt = Number.NaN
      return this.result(true, false, false, timestamp, expansion, expansionElapsedMs)
    }

    return this.result(false, false, false, timestamp, expansion, expansionElapsedMs)
  }

  private recentPeakDistance(timestamp: number): number {
    const cutoff = timestamp - this.config.historyWindowMs
    let peak = this.historyCount === 0 ? this.lastDistance : Number.NEGATIVE_INFINITY
    for (let offset = 0; offset < this.historyCount; offset += 1) {
      const index = (this.historyHead - 1 - offset + this.history.length) % this.history.length
      const entry = this.history[index]
      if (!entry) continue
      if (entry.timestamp < cutoff) break
      peak = Math.max(peak, entry.distance)
    }
    return Number.isFinite(peak) ? peak : this.lastDistance
  }

  private pushHistory(sample: HistorySample): void {
    this.history[this.historyHead] = sample
    this.historyHead = (this.historyHead + 1) % this.history.length
    this.historyCount = Math.min(this.historyCount + 1, this.history.length)
  }

  private clearArmCandidate(): void {
    this.armCandidateSince = Number.NaN
    this.armCandidateMinimum = Number.POSITIVE_INFINITY
  }

  private resetSequence(phase: 'idle' | 'cooldown'): void {
    this.phaseValue = phase
    this.clearArmCandidate()
    this.armedMinimum = Number.POSITIVE_INFINITY
    this.expansionStartedAt = Number.NaN
    this.releaseQualified = false
    this.releaseQualifiedAt = Number.NaN
    if (phase === 'idle') {
      this.lastChargeTimestamp = Number.NEGATIVE_INFINITY
      this.history.fill(undefined)
      this.historyHead = 0
      this.historyCount = 0
    }
  }

  private result(
    triggered: boolean,
    armedThisFrame: boolean,
    disarmedThisFrame: boolean,
    timestamp: number,
    expansion = Number.isFinite(this.armedMinimum) ? Math.max(0, this.lastDistance - this.armedMinimum) : 0,
    expansionElapsedMs = Number.isFinite(this.expansionStartedAt) && Number.isFinite(timestamp)
      ? Math.max(0, timestamp - this.expansionStartedAt)
      : 0,
  ): TwoHandReleaseUpdate {
    return {
      phase: this.phaseValue,
      triggered,
      armedThisFrame,
      disarmedThisFrame,
      filteredVelocity: this.filteredVelocity,
      expansion,
      expansionElapsedMs,
      cooldownRemainingMs: this.phaseValue === 'cooldown' && Number.isFinite(timestamp)
        ? Math.max(0, this.cooldownUntil - timestamp)
        : 0,
    }
  }
}
