import { describe, expect, it } from 'vitest'
import type { Handedness } from '../types/hand'
import { routePinchEvent } from './EffectManager'

const state = () => ({
  active: new Set<Handedness>(),
  blocked: new Set<Handedness>(),
})

describe('routePinchEvent', () => {
  it('recovers from a missed PINCH_START on the next move', () => {
    const { active, blocked } = state()

    expect(routePinchEvent('move', 'left', false, active, blocked)).toBe('move')
    expect(active.has('left')).toBe(true)
  })

  it('lets a new gesture lifecycle clear a stale block', () => {
    const { active, blocked } = state()
    blocked.add('right')

    expect(routePinchEvent('start', 'right', false, active, blocked)).toBe('start')
    expect(active.has('right')).toBe(true)
    expect(blocked.has('right')).toBe(false)
  })

  it('does not recover a blocked move or any move during dual charge', () => {
    const { active, blocked } = state()
    blocked.add('left')

    expect(routePinchEvent('move', 'left', false, active, blocked)).toBe('ignore')
    expect(routePinchEvent('move', 'right', true, active, blocked)).toBe('ignore')
    expect(active.size).toBe(0)
  })

  it('clears both active and blocked state when the pinch ends', () => {
    const { active, blocked } = state()
    active.add('left')
    blocked.add('left')

    expect(routePinchEvent('end', 'left', true, active, blocked)).toBe('end')
    expect(active.has('left')).toBe(false)
    expect(blocked.has('left')).toBe(false)
  })
})
