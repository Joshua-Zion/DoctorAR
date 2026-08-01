import type { CameraResolution, PerformanceMode } from '../types/settings'

export interface PerformancePreset {
  label: string
  inferenceFps: number
  inferenceLongEdge: number
  dprLimit: number
  particleLimit: number
  particleBurstLimit: number
  trailSegmentLimit: number
  trailSpacingPx: number
  shockwaveLimit: number
  defaultResolution: CameraResolution
}

export const PERFORMANCE_PRESETS: Record<PerformanceMode, PerformancePreset> = {
  low: {
    label: '低性能', inferenceFps: 18, inferenceLongEdge: 512, dprLimit: 1, particleLimit: 360,
    particleBurstLimit: 200, trailSegmentLimit: 96, trailSpacingPx: 7, shockwaveLimit: 2,
    defaultResolution: '640x480',
  },
  balanced: {
    label: '平衡', inferenceFps: 28, inferenceLongEdge: 640, dprLimit: 1.5, particleLimit: 720,
    particleBurstLimit: 320, trailSegmentLimit: 192, trailSpacingPx: 4.5, shockwaveLimit: 4,
    defaultResolution: '1280x720',
  },
  high: {
    label: '高质量', inferenceFps: 40, inferenceLongEdge: 960, dprLimit: 2, particleLimit: 1200,
    particleBurstLimit: 420, trailSegmentLimit: 320, trailSpacingPx: 3.5, shockwaveLimit: 6,
    defaultResolution: '1920x1080',
  },
}

export const RESOLUTION_OPTIONS: Array<{ value: CameraResolution; label: string; width: number; height: number }> = [
  { value: '640x480', label: '流畅 · 480p', width: 640, height: 480 },
  { value: '1280x720', label: '标准 · 720p', width: 1280, height: 720 },
  { value: '1920x1080', label: '清晰 · 1080p', width: 1920, height: 1080 },
]
