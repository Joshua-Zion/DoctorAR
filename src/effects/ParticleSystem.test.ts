import { describe, expect, it } from 'vitest'
import { PERFORMANCE_PRESETS } from '../config/performanceConfig'
import { calculateParticleBurstCount } from './ParticleSystem'

describe('calculateParticleBurstCount', () => {
  it('creates a dense default fist burst', () => {
    const count = calculateParticleBurstCount({
      amount: 0.72,
      intensity: 1.05,
      activeLimit: PERFORMANCE_PRESETS.balanced.particleLimit,
      burstLimit: PERFORMANCE_PRESETS.balanced.particleBurstLimit,
    })

    expect(count).toBeGreaterThanOrEqual(175)
    expect(count).toBeLessThanOrEqual(230)
  })

  it('honors the performance burst budget for extreme input', () => {
    const preset = PERFORMANCE_PRESETS.low
    const count = calculateParticleBurstCount({
      amount: 99,
      intensity: 99,
      activeLimit: preset.particleLimit,
      burstLimit: preset.particleBurstLimit,
    })

    expect(count).toBe(preset.particleBurstLimit)
  })

  it('never exceeds the currently active particle limit', () => {
    expect(calculateParticleBurstCount({
      amount: 1,
      intensity: 1,
      activeLimit: 48,
      burstLimit: 200,
    })).toBe(48)
  })
})
