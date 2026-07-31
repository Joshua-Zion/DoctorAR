import type { GestureEvent } from '../types/gesture'

type SoundKind = 'appear' | 'burst' | 'charge' | 'release'

export class AudioManager {
  private context: AudioContext | null = null
  private master: GainNode | null = null
  private enabled = false
  private volume = 0.2
  private readonly lastPlayed = new Map<SoundKind, number>()

  setEnabled(enabled: boolean): void {
    this.enabled = enabled
    if (enabled) void this.ensureContext()
  }

  setVolume(volume: number): void {
    this.volume = Math.max(0, Math.min(1, volume))
    if (this.master && this.context) this.master.gain.setTargetAtTime(this.volume, this.context.currentTime, 0.04)
  }

  handle(event: GestureEvent): void {
    if (!this.enabled) return
    if (event.type === 'PALM_OPEN') this.play('appear')
    if (event.type === 'FIST') this.play('burst')
    if (event.type === 'TWO_HAND_CHARGE_START') this.play('charge')
    if (event.type === 'TWO_HAND_RELEASE') this.play('release')
  }

  dispose(): void {
    const context = this.context
    this.context = null
    this.master = null
    if (context && context.state !== 'closed') void context.close()
  }

  private async ensureContext(): Promise<AudioContext | null> {
    if (!this.context) {
      this.context = new AudioContext()
      this.master = this.context.createGain()
      this.master.gain.value = this.volume
      this.master.connect(this.context.destination)
    }
    if (this.context.state === 'suspended') await this.context.resume()
    return this.context
  }

  private play(kind: SoundKind): void {
    const nowMs = performance.now()
    const cooldown = kind === 'appear' ? 260 : 480
    if (nowMs - (this.lastPlayed.get(kind) ?? 0) < cooldown) return
    this.lastPlayed.set(kind, nowMs)

    void this.ensureContext().then((context) => {
      if (!context || !this.master || !this.enabled) return
      const now = context.currentTime
      const oscillator = context.createOscillator()
      const gain = context.createGain()
      const filter = context.createBiquadFilter()

      filter.type = 'bandpass'
      filter.Q.value = kind === 'charge' ? 4 : 1.2
      oscillator.type = kind === 'burst' ? 'sawtooth' : 'sine'

      const startFrequency = kind === 'appear' ? 240 : kind === 'charge' ? 120 : kind === 'release' ? 360 : 90
      const endFrequency = kind === 'appear' ? 540 : kind === 'charge' ? 260 : kind === 'release' ? 70 : 36
      const duration = kind === 'charge' ? 0.7 : kind === 'release' ? 0.55 : 0.28

      oscillator.frequency.setValueAtTime(startFrequency, now)
      oscillator.frequency.exponentialRampToValueAtTime(endFrequency, now + duration)
      filter.frequency.setValueAtTime(Math.max(160, startFrequency * 2), now)
      filter.frequency.exponentialRampToValueAtTime(Math.max(120, endFrequency * 2), now + duration)
      gain.gain.setValueAtTime(0.0001, now)
      gain.gain.exponentialRampToValueAtTime(kind === 'burst' ? 0.14 : 0.08, now + 0.025)
      gain.gain.exponentialRampToValueAtTime(0.0001, now + duration)

      oscillator.connect(filter)
      filter.connect(gain)
      gain.connect(this.master)
      oscillator.start(now)
      oscillator.stop(now + duration + 0.02)
    })
  }
}
