import type { GestureEvent, GesturePose } from '../types/gesture'
import type { Handedness, Vector3Like } from '../types/hand'

type OneShotKind = 'appear' | 'burst' | 'shockwave'

interface SynthVoice {
  gain: GainNode
  oscillators: OscillatorNode[]
  nodes: AudioNode[]
  stopping: boolean
  cleanupTimer: number | null
}

interface EnergyVoice extends SynthVoice {
  low: OscillatorNode
  high: OscillatorNode
  filter: BiquadFilterNode
}

interface PinchVoice extends SynthVoice {
  carrier: OscillatorNode
  shimmer: OscillatorNode
  filter: BiquadFilterNode
  panner: StereoPannerNode
}

const HANDEDNESSES: readonly Handedness[] = ['left', 'right']
const MIN_GAIN = 0.0001
const ENERGY_UPDATE_INTERVAL_MS = 48
const PINCH_UPDATE_INTERVAL_MS = 34

const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.max(minimum, Math.min(maximum, value))

/** Original oscillator-only feedback. No recorded samples or external audio assets are used. */
export class AudioManager {
  private context: AudioContext | null = null
  private master: GainNode | null = null
  private enabled = false
  private volume = 0.2
  private energyVoice: EnergyVoice | null = null
  private energyStartPending = false
  private energyEpoch = 0
  private palmLastUpdateMs = 0
  private chargeLastUpdateMs = 0
  private chargeActive = false
  private chargeDistance = 0.3
  private chargeVelocity = 0
  private readonly activePalms = new Set<Handedness>()
  private readonly pinchVoices: Record<Handedness, PinchVoice | null> = { left: null, right: null }
  private readonly pinchEpoch: Record<Handedness, number> = { left: 0, right: 0 }
  private readonly pinchLastUpdateMs: Record<Handedness, number> = { left: 0, right: 0 }
  private readonly lastPlayed = new Map<OneShotKind, number>()
  private readonly oneShots = new Set<SynthVoice>()

  setEnabled(enabled: boolean): void {
    if (this.enabled === enabled) return
    this.enabled = enabled
    if (!enabled) {
      this.resetGestureState()
      this.fadeAll(0.045)
      return
    }

    void this.ensureContext().then((context) => {
      if (!context || !this.master || !this.enabled) return
      this.master.gain.cancelScheduledValues(context.currentTime)
      this.master.gain.setTargetAtTime(this.volume, context.currentTime, 0.025)
    })
  }

  setVolume(volume: number): void {
    this.volume = clamp(volume, 0, 1)
    if (this.master && this.context && this.context.state !== 'closed') {
      this.master.gain.setTargetAtTime(this.enabled ? this.volume : MIN_GAIN, this.context.currentTime, 0.04)
    }
  }

  handle(event: GestureEvent): void {
    if (!this.enabled) return

    switch (event.type) {
      case 'PALM_OPEN':
        this.activePalms.add(event.hand)
        this.playOneShot('appear', 0.72 + event.pose.confidence * 0.28)
        this.ensureEnergyVoice()
        this.updateEnergyFromPalm(event.pose, true)
        break
      case 'PALM_UPDATE':
        if (!this.chargeActive && this.activePalms.has(event.hand)) this.updateEnergyFromPalm(event.pose)
        break
      case 'PALM_CLOSE':
        this.activePalms.delete(event.hand)
        this.stopEnergyWhenIdle()
        break
      case 'FIST':
        this.activePalms.delete(event.hand)
        this.playOneShot('burst', 0.72 + event.intensity * 0.45)
        this.stopEnergyWhenIdle()
        break
      case 'HAND_LOST':
        this.activePalms.delete(event.hand)
        this.stopPinch(event.hand)
        this.stopEnergyWhenIdle()
        break
      case 'TWO_HAND_CHARGE_START':
        this.chargeActive = true
        this.chargeDistance = event.distance
        this.chargeVelocity = 0
        this.ensureEnergyVoice()
        this.updateChargeVoice(true)
        break
      case 'TWO_HAND_CHARGE_UPDATE':
        this.chargeActive = true
        this.chargeDistance = event.distance
        this.chargeVelocity = event.velocity
        this.updateChargeVoice()
        break
      case 'TWO_HAND_CHARGE_END':
        this.chargeActive = false
        this.chargeVelocity = 0
        if (this.activePalms.size > 0) this.updateEnergyFromState(true)
        else this.stopEnergyVoice(0.12)
        break
      case 'TWO_HAND_RELEASE':
        this.chargeActive = false
        this.chargeVelocity = 0
        this.playOneShot('shockwave', 0.9 + Math.abs(event.velocity) * 0.38)
        if (this.activePalms.size > 0) this.updateEnergyFromState(true)
        else this.stopEnergyVoice(0.08)
        break
      case 'PINCH_START':
        this.startPinch(event.hand, event.position)
        break
      case 'PINCH_MOVE':
        this.updatePinch(event.hand, event.position)
        break
      case 'PINCH_END':
        this.stopPinch(event.hand)
        break
    }
  }

  dispose(): void {
    this.enabled = false
    this.resetGestureState()
    this.fadeAll(0.02)

    const context = this.context
    const master = this.master
    this.context = null
    this.master = null
    this.lastPlayed.clear()

    if (!context || context.state === 'closed') return
    master?.gain.setTargetAtTime(MIN_GAIN, context.currentTime, 0.006)
    window.setTimeout(() => {
      if (context.state !== 'closed') void context.close()
    }, 32)
  }

  private async ensureContext(): Promise<AudioContext | null> {
    if (!this.enabled) return null
    if (!this.context || this.context.state === 'closed') {
      const context = new AudioContext()
      const master = context.createGain()
      master.gain.value = this.volume
      master.connect(context.destination)
      this.context = context
      this.master = master
    }

    const context = this.context
    try {
      if (context.state === 'suspended') await context.resume()
    } catch {
      return null
    }
    return this.enabled && this.context === context && context.state !== 'closed' ? context : null
  }

  private playOneShot(kind: OneShotKind, intensity = 1): void {
    const nowMs = performance.now()
    const cooldown = kind === 'appear' ? 240 : kind === 'burst' ? 320 : 620
    if (nowMs - (this.lastPlayed.get(kind) ?? 0) < cooldown) return
    this.lastPlayed.set(kind, nowMs)

    void this.ensureContext().then((context) => {
      const master = this.master
      if (!context || !master || !this.enabled) return

      const now = context.currentTime
      const gain = context.createGain()
      const filter = context.createBiquadFilter()
      const primary = context.createOscillator()
      const secondary = context.createOscillator()
      const normalizedIntensity = clamp(intensity, 0.45, 1.65)
      const duration = kind === 'appear' ? 0.34 : kind === 'burst' ? 0.3 : 0.78
      const peak = (kind === 'appear' ? 0.042 : kind === 'burst' ? 0.105 : 0.13) * normalizedIntensity

      filter.type = kind === 'shockwave' ? 'lowpass' : 'bandpass'
      filter.Q.value = kind === 'appear' ? 5.2 : kind === 'burst' ? 1.1 : 0.72
      primary.type = kind === 'appear' ? 'sine' : 'sawtooth'
      secondary.type = kind === 'burst' ? 'square' : 'sine'

      const primaryStart = kind === 'appear' ? 230 : kind === 'burst' ? 105 : 280
      const primaryEnd = kind === 'appear' ? 690 : kind === 'burst' ? 38 : 42
      const secondaryStart = kind === 'appear' ? 345 : kind === 'burst' ? 68 : 98
      const secondaryEnd = kind === 'appear' ? 1035 : kind === 'burst' ? 31 : 28
      primary.frequency.setValueAtTime(primaryStart, now)
      primary.frequency.exponentialRampToValueAtTime(primaryEnd, now + duration)
      secondary.frequency.setValueAtTime(secondaryStart, now)
      secondary.frequency.exponentialRampToValueAtTime(secondaryEnd, now + duration)
      secondary.detune.value = kind === 'appear' ? 7 : -9
      filter.frequency.setValueAtTime(kind === 'appear' ? 760 : kind === 'burst' ? 430 : 1250, now)
      filter.frequency.exponentialRampToValueAtTime(kind === 'appear' ? 1450 : kind === 'burst' ? 120 : 135, now + duration)

      gain.gain.setValueAtTime(MIN_GAIN, now)
      gain.gain.exponentialRampToValueAtTime(Math.max(MIN_GAIN, peak), now + (kind === 'shockwave' ? 0.035 : 0.018))
      gain.gain.exponentialRampToValueAtTime(MIN_GAIN, now + duration)
      primary.connect(filter)
      secondary.connect(filter)
      filter.connect(gain)
      gain.connect(master)

      const voice: SynthVoice = {
        gain,
        oscillators: [primary, secondary],
        nodes: [primary, secondary, filter, gain],
        stopping: false,
        cleanupTimer: null,
      }
      this.oneShots.add(voice)
      primary.addEventListener('ended', () => this.cleanupVoice(voice), { once: true })
      primary.start(now)
      secondary.start(now)
      primary.stop(now + duration + 0.025)
      secondary.stop(now + duration + 0.025)
    })
  }

  private ensureEnergyVoice(): void {
    if (this.energyVoice || this.energyStartPending || !this.enabled) return
    this.energyStartPending = true
    const epoch = this.energyEpoch

    void this.ensureContext().then((context) => {
      this.energyStartPending = false
      const master = this.master
      if (!context || !master || !this.enabled || epoch !== this.energyEpoch || (!this.chargeActive && this.activePalms.size === 0)) return

      const now = context.currentTime
      const low = context.createOscillator()
      const high = context.createOscillator()
      const pulse = context.createOscillator()
      const pulseDepth = context.createGain()
      const filter = context.createBiquadFilter()
      const gain = context.createGain()
      low.type = 'sine'
      high.type = 'triangle'
      pulse.type = 'sine'
      low.frequency.value = 92
      high.frequency.value = 184
      high.detune.value = 5
      pulse.frequency.value = 1.85
      pulseDepth.gain.value = 0.006
      filter.type = 'lowpass'
      filter.frequency.value = 620
      filter.Q.value = 2.4
      gain.gain.setValueAtTime(MIN_GAIN, now)
      gain.gain.exponentialRampToValueAtTime(0.027, now + 0.16)
      low.connect(filter)
      high.connect(filter)
      filter.connect(gain)
      pulse.connect(pulseDepth)
      pulseDepth.connect(gain.gain)
      gain.connect(master)

      const voice: EnergyVoice = {
        low,
        high,
        filter,
        gain,
        oscillators: [low, high, pulse],
        nodes: [low, high, pulse, pulseDepth, filter, gain],
        stopping: false,
        cleanupTimer: null,
      }
      this.energyVoice = voice
      low.start(now)
      high.start(now)
      pulse.start(now)
      this.updateEnergyFromState(true)
    })
  }

  private updateEnergyFromPalm(pose: GesturePose, force = false): void {
    this.ensureEnergyVoice()
    const voice = this.energyVoice
    const context = this.context
    const nowMs = performance.now()
    if (!voice || !context || (!force && nowMs - this.palmLastUpdateMs < ENERGY_UPDATE_INTERVAL_MS)) return
    this.palmLastUpdateMs = nowMs

    const width = clamp(pose.width, 0.035, 0.34)
    const positionTone = clamp(1 - pose.position.y, 0, 1)
    const base = 78 + width * 155 + positionTone * 22
    const energyGain = clamp(0.018 + pose.confidence * 0.012 + width * 0.025, 0.018, 0.045)
    const now = context.currentTime
    voice.low.frequency.setTargetAtTime(base, now, 0.045)
    voice.high.frequency.setTargetAtTime(base * 2.01, now, 0.045)
    voice.filter.frequency.setTargetAtTime(480 + positionTone * 420, now, 0.06)
    voice.gain.gain.setTargetAtTime(energyGain, now, 0.055)
  }

  private updateChargeVoice(force = false): void {
    this.ensureEnergyVoice()
    if (!this.chargeActive) return
    const voice = this.energyVoice
    const context = this.context
    const nowMs = performance.now()
    if (!voice || !context || (!force && nowMs - this.chargeLastUpdateMs < ENERGY_UPDATE_INTERVAL_MS)) return
    this.chargeLastUpdateMs = nowMs

    const distance = clamp(this.chargeDistance, 0.1, 0.72)
    const motion = clamp(Math.abs(this.chargeVelocity), 0, 1.8)
    const base = 82 + distance * 185 + motion * 24
    const now = context.currentTime
    voice.low.frequency.setTargetAtTime(base, now, 0.035)
    voice.high.frequency.setTargetAtTime(base * 2.02, now, 0.035)
    voice.filter.frequency.setTargetAtTime(650 + distance * 980 + motion * 180, now, 0.045)
    voice.gain.gain.setTargetAtTime(clamp(0.03 + distance * 0.025 + motion * 0.012, 0.03, 0.068), now, 0.04)
  }

  private updateEnergyFromState(force = false): void {
    if (this.chargeActive) {
      this.updateChargeVoice(force)
      return
    }
    const voice = this.energyVoice
    const context = this.context
    if (!voice || !context) return
    const now = context.currentTime
    voice.low.frequency.setTargetAtTime(96, now, 0.06)
    voice.high.frequency.setTargetAtTime(193, now, 0.06)
    voice.filter.frequency.setTargetAtTime(620, now, 0.08)
    voice.gain.gain.setTargetAtTime(0.026, now, 0.07)
  }

  private stopEnergyWhenIdle(): void {
    if (!this.chargeActive && this.activePalms.size === 0) this.stopEnergyVoice(0.13)
  }

  private stopEnergyVoice(fadeSeconds: number): void {
    this.energyEpoch += 1
    this.energyStartPending = false
    const voice = this.energyVoice
    this.energyVoice = null
    if (voice) this.stopVoice(voice, fadeSeconds)
  }

  private startPinch(hand: Handedness, position: Vector3Like): void {
    this.stopPinch(hand, 0.025)
    const epoch = ++this.pinchEpoch[hand]

    void this.ensureContext().then((context) => {
      const master = this.master
      if (!context || !master || !this.enabled || epoch !== this.pinchEpoch[hand]) return

      const now = context.currentTime
      const carrier = context.createOscillator()
      const shimmer = context.createOscillator()
      const filter = context.createBiquadFilter()
      const panner = context.createStereoPanner()
      const gain = context.createGain()
      carrier.type = 'sine'
      shimmer.type = 'triangle'
      carrier.frequency.value = 620
      shimmer.frequency.value = 1247
      shimmer.detune.value = hand === 'left' ? -8 : 8
      filter.type = 'bandpass'
      filter.Q.value = 7.5
      filter.frequency.value = 980
      gain.gain.setValueAtTime(MIN_GAIN, now)
      gain.gain.exponentialRampToValueAtTime(0.026, now + 0.055)
      carrier.connect(filter)
      shimmer.connect(filter)
      filter.connect(panner)
      panner.connect(gain)
      gain.connect(master)

      const voice: PinchVoice = {
        carrier,
        shimmer,
        filter,
        panner,
        gain,
        oscillators: [carrier, shimmer],
        nodes: [carrier, shimmer, filter, panner, gain],
        stopping: false,
        cleanupTimer: null,
      }
      this.pinchVoices[hand] = voice
      carrier.start(now)
      shimmer.start(now)
      this.applyPinchPosition(voice, hand, position, true)
    })
  }

  private updatePinch(hand: Handedness, position: Vector3Like): void {
    const voice = this.pinchVoices[hand]
    if (!voice) return
    this.applyPinchPosition(voice, hand, position)
  }

  private applyPinchPosition(voice: PinchVoice, hand: Handedness, position: Vector3Like, force = false): void {
    const context = this.context
    const nowMs = performance.now()
    if (!context || (!force && nowMs - this.pinchLastUpdateMs[hand] < PINCH_UPDATE_INTERVAL_MS)) return
    this.pinchLastUpdateMs[hand] = nowMs

    const x = clamp(position.x, 0, 1)
    const y = clamp(position.y, 0, 1)
    const depth = clamp(-position.z, -0.25, 0.35)
    const frequency = 440 + (1 - y) * 620 + depth * 210 + (hand === 'left' ? -18 : 18)
    const now = context.currentTime
    voice.carrier.frequency.setTargetAtTime(Math.max(80, frequency), now, 0.022)
    voice.shimmer.frequency.setTargetAtTime(Math.max(160, frequency * 2.015), now, 0.024)
    voice.filter.frequency.setTargetAtTime(clamp(frequency * 1.48, 520, 2300), now, 0.028)
    voice.panner.pan.setTargetAtTime(clamp((x - 0.5) * 1.7, -0.9, 0.9), now, 0.03)
    voice.gain.gain.setTargetAtTime(0.021 + (1 - y) * 0.012, now, 0.035)
  }

  private stopPinch(hand: Handedness, fadeSeconds = 0.075): void {
    this.pinchEpoch[hand] += 1
    const voice = this.pinchVoices[hand]
    this.pinchVoices[hand] = null
    if (voice) this.stopVoice(voice, fadeSeconds)
  }

  private fadeAll(fadeSeconds: number): void {
    this.stopEnergyVoice(fadeSeconds)
    for (const hand of HANDEDNESSES) this.stopPinch(hand, fadeSeconds)
    for (const voice of [...this.oneShots]) this.stopVoice(voice, fadeSeconds)

    if (this.master && this.context && this.context.state !== 'closed') {
      this.master.gain.setTargetAtTime(MIN_GAIN, this.context.currentTime, Math.max(0.005, fadeSeconds / 3))
    }
  }

  private resetGestureState(): void {
    this.activePalms.clear()
    this.chargeActive = false
    this.chargeVelocity = 0
    this.palmLastUpdateMs = 0
    this.chargeLastUpdateMs = 0
    for (const hand of HANDEDNESSES) this.pinchLastUpdateMs[hand] = 0
  }

  private stopVoice(voice: SynthVoice, fadeSeconds: number): void {
    if (voice.stopping) return
    voice.stopping = true
    const context = this.context
    if (!context || context.state === 'closed') {
      this.cleanupVoice(voice)
      return
    }

    const now = context.currentTime
    voice.gain.gain.cancelScheduledValues(now)
    voice.gain.gain.setTargetAtTime(MIN_GAIN, now, Math.max(0.004, fadeSeconds / 3))
    for (const oscillator of voice.oscillators) {
      try {
        oscillator.stop(now + fadeSeconds + 0.018)
      } catch {
        // An oscillator that reached its natural stop is already being cleaned up.
      }
    }
    voice.cleanupTimer = window.setTimeout(() => this.cleanupVoice(voice), Math.ceil((fadeSeconds + 0.06) * 1000))
  }

  private cleanupVoice(voice: SynthVoice): void {
    if (voice.cleanupTimer !== null) window.clearTimeout(voice.cleanupTimer)
    voice.cleanupTimer = null
    this.oneShots.delete(voice)
    if (this.energyVoice === voice) this.energyVoice = null
    for (const hand of HANDEDNESSES) {
      if (this.pinchVoices[hand] === voice) this.pinchVoices[hand] = null
    }
    for (const node of voice.nodes) node.disconnect()
  }
}
