import type { CameraResolution, PerformanceMode } from '../types/settings'

export interface PerformancePreset {
  label: string
  inferenceFps: number
  dprLimit: number
  particleLimit: number
  defaultResolution: CameraResolution
}

export const PERFORMANCE_PRESETS: Record<PerformanceMode, PerformancePreset> = {
  low: { label: '低性能', inferenceFps: 18, dprLimit: 1, particleLimit: 360, defaultResolution: '640x480' },
  balanced: { label: '平衡', inferenceFps: 28, dprLimit: 1.5, particleLimit: 720, defaultResolution: '1280x720' },
  high: { label: '高质量', inferenceFps: 40, dprLimit: 2, particleLimit: 1200, defaultResolution: '1920x1080' },
}

export const RESOLUTION_OPTIONS: Array<{ value: CameraResolution; label: string; width: number; height: number }> = [
  { value: '640x480', label: '流畅 · 480p', width: 640, height: 480 },
  { value: '1280x720', label: '标准 · 720p', width: 1280, height: 720 },
  { value: '1920x1080', label: '清晰 · 1080p', width: 1920, height: 1080 },
]
