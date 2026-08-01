import { useEffect, useRef, type RefObject } from 'react'
import type { EffectManager } from '../effects/EffectManager'
import type { GestureEventBus } from '../vision/GestureEventBus'
import type { AppSettings } from '../types/settings'
import type { RuntimeMetrics } from '../types/runtime'

interface EffectStageProps {
  eventBus: GestureEventBus
  settings: AppSettings
  videoRef: RefObject<HTMLVideoElement | null>
  metricsRef: RefObject<RuntimeMetrics>
  onError: (message: string) => void
}

export const EffectStage = ({ eventBus, settings, videoRef, metricsRef, onError }: EffectStageProps) => {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const managerRef = useRef<EffectManager | null>(null)
  const settingsRef = useRef(settings)
  settingsRef.current = settings

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    let cancelled = false
    void import('../effects/EffectManager').then(({ EffectManager: EffectManagerClass }) => {
      if (cancelled) return
      const manager = new EffectManagerClass(canvas, eventBus, (stats) => {
        const metrics = metricsRef.current
        metrics.renderMs = stats.renderMs
        metrics.activeParticles = stats.activeParticles
        metrics.activeTrailSegments = stats.activeTrailSegments
        metrics.activeShockwaves = stats.activeShockwaves
        metrics.drawCalls = stats.drawCalls
      })
      if (cancelled) {
        manager.dispose()
        return
      }
      const current = settingsRef.current
      manager.configure({
        enabled: current.effectsEnabled,
        particlesEnabled: current.particlesEnabled,
        theme: current.theme,
        scale: current.effectScale,
        brightness: current.brightness,
        particleAmount: current.particleAmount,
        particleSpeed: current.particleSpeed,
        performanceMode: current.performanceMode,
      })
      const video = videoRef.current
      if (video?.videoWidth && video.videoHeight) manager.setVideoSize(video.videoWidth, video.videoHeight, 'cover')
      managerRef.current = manager
      manager.start()
    }).catch((error: unknown) => {
      if (!cancelled) onError(error instanceof Error ? error.message : 'WebGL 特效层初始化失败。')
    })

    return () => {
      cancelled = true
      managerRef.current?.dispose()
      managerRef.current = null
    }
  }, [eventBus, metricsRef, onError, videoRef])

  useEffect(() => {
    managerRef.current?.configure({
      enabled: settings.effectsEnabled,
      particlesEnabled: settings.particlesEnabled,
      theme: settings.theme,
      scale: settings.effectScale,
      brightness: settings.brightness,
      particleAmount: settings.particleAmount,
      particleSpeed: settings.particleSpeed,
      performanceMode: settings.performanceMode,
    })
  }, [settings])

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    const syncVideoSize = (): void => {
      if (video.videoWidth > 0 && video.videoHeight > 0) {
        managerRef.current?.setVideoSize(video.videoWidth, video.videoHeight, 'cover')
      }
    }
    syncVideoSize()
    video.addEventListener('loadedmetadata', syncVideoSize)
    video.addEventListener('resize', syncVideoSize)
    return () => {
      video.removeEventListener('loadedmetadata', syncVideoSize)
      video.removeEventListener('resize', syncVideoSize)
    }
  }, [videoRef])

  return <canvas ref={canvasRef} className="effect-layer" aria-hidden="true" />
}
