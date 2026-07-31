import type { PerformanceMode, ThemeId } from './settings'

export interface EffectRuntimeSettings {
  enabled: boolean
  particlesEnabled: boolean
  theme: ThemeId
  scale: number
  brightness: number
  particleAmount: number
  particleSpeed: number
  performanceMode: PerformanceMode
}

export interface EffectStats {
  renderMs: number
  activeParticles: number
  drawCalls: number
}
