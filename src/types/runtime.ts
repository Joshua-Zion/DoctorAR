export interface RuntimeMetrics {
  fps: number
  inferenceMs: number
  inferenceFps: number
  workerRoundTripMs: number
  droppedInferenceFrames: number
  visionBackend: 'idle' | 'worker' | 'main'
  renderMs: number
  activeParticles: number
  activeTrailSegments: number
  activeShockwaves: number
  drawCalls: number
  handCount: number
}

export const EMPTY_METRICS: RuntimeMetrics = {
  fps: 0,
  inferenceMs: 0,
  inferenceFps: 0,
  workerRoundTripMs: 0,
  droppedInferenceFrames: 0,
  visionBackend: 'idle',
  renderMs: 0,
  activeParticles: 0,
  activeTrailSegments: 0,
  activeShockwaves: 0,
  drawCalls: 0,
  handCount: 0,
}
