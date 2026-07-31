import type { GesturePhase } from '../types/gesture'
import { clamp } from '../utils/math'

export interface GestureStateMachineConfig {
  enterScore: number
  exitScore: number
  minHoldMs: number
  maxInterruptMs: number
  cooldownMs: number
  confidence: number
}

export interface GestureStateSample {
  timestamp: number
  score: number
  confidence: number
  present?: boolean
  sensitivity?: number
  cooldownMs?: number
}

export interface GestureStateUpdate {
  phase: GesturePhase
  previousPhase: GesturePhase
  activated: boolean
  released: boolean
  changed: boolean
  activeDurationMs: number
}

export class GestureStateMachine {
  private readonly config: GestureStateMachineConfig
  private phaseValue: GesturePhase = 'idle'
  private candidateSince = 0
  private activeSince = 0
  private interruptedSince = 0
  private cooldownUntil = 0
  private lastTimestamp = 0

  constructor(config: GestureStateMachineConfig) {
    this.config = { ...config }
  }

  get phase(): GesturePhase {
    return this.phaseValue
  }

  get isActive(): boolean {
    return this.phaseValue === 'active'
  }

  update(sample: GestureStateSample): GestureStateUpdate {
    const timestamp = Math.max(this.lastTimestamp, sample.timestamp)
    this.lastTimestamp = timestamp
    const previousPhase = this.phaseValue
    let activated = false
    let released = false

    if (this.phaseValue === 'released') this.phaseValue = 'cooldown'
    if (this.phaseValue === 'cooldown' && timestamp >= this.cooldownUntil) this.phaseValue = 'idle'

    const sensitivityScale = 0.75 + clamp(sample.sensitivity ?? 0.5, 0, 1) * 0.65
    const enterThreshold = clamp(this.config.enterScore / sensitivityScale, 0.05, 0.99)
    const exitThreshold = clamp(this.config.exitScore / sensitivityScale, 0.03, enterThreshold)
    const confident = (sample.present ?? true) && sample.confidence >= this.config.confidence
    const enters = confident && sample.score >= enterThreshold
    const remains = confident && sample.score >= exitThreshold

    if (this.phaseValue === 'idle' && enters) {
      this.phaseValue = 'candidate'
      this.candidateSince = timestamp
      this.interruptedSince = 0
      if (this.config.minHoldMs <= 0) {
        this.phaseValue = 'active'
        this.activeSince = timestamp
        activated = true
      }
    } else if (this.phaseValue === 'candidate') {
      if (enters) {
        this.interruptedSince = 0
        if (timestamp - this.candidateSince >= this.config.minHoldMs) {
          this.phaseValue = 'active'
          this.activeSince = timestamp
          activated = true
        }
      } else {
        if (this.interruptedSince === 0) this.interruptedSince = timestamp
        if (timestamp - this.interruptedSince >= this.config.maxInterruptMs) {
          this.phaseValue = 'idle'
          this.candidateSince = 0
          this.interruptedSince = 0
        }
      }
    } else if (this.phaseValue === 'active') {
      if (remains) {
        this.interruptedSince = 0
      } else {
        if (this.interruptedSince === 0) this.interruptedSince = timestamp
        if (timestamp - this.interruptedSince >= this.config.maxInterruptMs) {
          this.phaseValue = 'released'
          this.cooldownUntil = timestamp + Math.max(0, sample.cooldownMs ?? this.config.cooldownMs)
          this.interruptedSince = 0
          released = true
        }
      }
    }

    return this.makeUpdate(previousPhase, activated, released, timestamp)
  }

  forceRelease(timestamp: number, cooldownMs?: number): GestureStateUpdate {
    const normalizedTimestamp = Math.max(this.lastTimestamp, timestamp)
    this.lastTimestamp = normalizedTimestamp
    const previousPhase = this.phaseValue
    const released = this.phaseValue === 'active' || this.phaseValue === 'candidate'
    if (released) {
      this.phaseValue = 'released'
      this.cooldownUntil = normalizedTimestamp + Math.max(0, cooldownMs ?? this.config.cooldownMs)
    } else if (this.phaseValue !== 'cooldown') {
      this.phaseValue = 'idle'
    }
    this.candidateSince = 0
    this.interruptedSince = 0
    return this.makeUpdate(previousPhase, false, released, normalizedTimestamp)
  }

  reset(): void {
    this.phaseValue = 'idle'
    this.candidateSince = 0
    this.activeSince = 0
    this.interruptedSince = 0
    this.cooldownUntil = 0
    this.lastTimestamp = 0
  }

  private makeUpdate(
    previousPhase: GesturePhase,
    activated: boolean,
    released: boolean,
    timestamp: number,
  ): GestureStateUpdate {
    return {
      phase: this.phaseValue,
      previousPhase,
      activated,
      released,
      changed: previousPhase !== this.phaseValue,
      activeDurationMs: this.activeSince > 0 && (this.phaseValue === 'active' || released)
        ? Math.max(0, timestamp - this.activeSince)
        : 0,
    }
  }
}
