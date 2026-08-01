export type ThemeId = 'ember' | 'aether' | 'chaos' | 'verdant' | 'inferno'

export type PerformanceMode = 'low' | 'balanced' | 'high'

export type CameraResolution = '640x480' | '1280x720' | '1920x1080'

export interface AppSettings {
  trackingEnabled: boolean
  showLandmarks: boolean
  showConnections: boolean
  effectsEnabled: boolean
  particlesEnabled: boolean
  soundEnabled: boolean
  soundVolume: number
  debugEnabled: boolean
  theme: ThemeId
  effectScale: number
  brightness: number
  particleAmount: number
  particleSpeed: number
  gestureSensitivity: number
  smoothing: number
  cooldownMs: number
  cameraId: string
  resolution: CameraResolution
  performanceMode: PerformanceMode
}

export const DEFAULT_SETTINGS: AppSettings = {
  trackingEnabled: true,
  showLandmarks: false,
  showConnections: false,
  effectsEnabled: true,
  particlesEnabled: true,
  soundEnabled: false,
  soundVolume: 0.3,
  debugEnabled: false,
  theme: 'ember',
  effectScale: 1,
  brightness: 1,
  particleAmount: 0.72,
  particleSpeed: 1,
  gestureSensitivity: 0.58,
  smoothing: 0.68,
  cooldownMs: 720,
  cameraId: '',
  resolution: '1280x720',
  performanceMode: 'balanced',
}
