export interface RuntimeMetrics {
  fps: number
  inferenceMs: number
  renderMs: number
  activeParticles: number
  drawCalls: number
  handCount: number
}

export const EMPTY_METRICS: RuntimeMetrics = {
  fps: 0,
  inferenceMs: 0,
  renderMs: 0,
  activeParticles: 0,
  drawCalls: 0,
  handCount: 0,
}
