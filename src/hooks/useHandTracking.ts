import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import { PERFORMANCE_PRESETS } from '../config/performanceConfig'
import type { HandFrame } from '../types/hand'
import type { RuntimeMetrics } from '../types/runtime'
import type { AppSettings } from '../types/settings'
import { GestureCoordinator } from '../vision/GestureCoordinator'
import type { GestureEventBus } from '../vision/GestureEventBus'
import type { HandTracker } from '../vision/HandTracker'

export type TrackingStatus = 'idle' | 'loading' | 'ready' | 'error'

interface UseHandTrackingOptions {
  enabled: boolean
  cameraReady: boolean
  videoRef: RefObject<HTMLVideoElement | null>
  settings: AppSettings
  eventBus: GestureEventBus
  metricsRef: RefObject<RuntimeMetrics>
  onFrame: (frame: HandFrame) => void
}

export interface HandTrackingState {
  status: TrackingStatus
  error: string
  retry: () => void
}

export const useHandTracking = ({
  enabled,
  cameraReady,
  videoRef,
  settings,
  eventBus,
  metricsRef,
  onFrame,
}: UseHandTrackingOptions): HandTrackingState => {
  const [status, setStatus] = useState<TrackingStatus>('idle')
  const [error, setError] = useState('')
  const [retryKey, setRetryKey] = useState(0)
  const settingsRef = useRef(settings)
  const onFrameRef = useRef(onFrame)
  settingsRef.current = settings
  onFrameRef.current = onFrame

  useEffect(() => {
    if (!enabled || !cameraReady) {
      setStatus('idle')
      return
    }

    let cancelled = false
    let animationFrame = 0
    let tracker: HandTracker | null = null
    const coordinator = new GestureCoordinator(eventBus)
    let lastVideoTime = -1
    let lastInferenceAt = 0

    const stopEffects = (): void => {
      eventBus.emit({ type: 'HAND_LOST', hand: 'left' })
      eventBus.emit({ type: 'HAND_LOST', hand: 'right' })
      eventBus.emit({ type: 'TWO_HAND_CHARGE_END' })
    }

    const tick = (now: number): void => {
      if (cancelled) return
      const video = videoRef.current
      const currentSettings = settingsRef.current
      const preset = PERFORMANCE_PRESETS[currentSettings.performanceMode]
      const minimumInterval = 1000 / preset.inferenceFps

      if (
        tracker &&
        currentSettings.trackingEnabled &&
        !document.hidden &&
        video &&
        video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
        video.currentTime !== lastVideoTime &&
        now - lastInferenceAt >= minimumInterval
      ) {
        try {
          const frame = tracker.detect(video, now, currentSettings.smoothing, currentSettings.gestureSensitivity)
          coordinator.process(frame, {
            sensitivity: currentSettings.gestureSensitivity,
            cooldownMs: currentSettings.cooldownMs,
          })
          lastVideoTime = video.currentTime
          lastInferenceAt = now
          const metrics = metricsRef.current
          metrics.inferenceMs = frame.inferenceMs
          metrics.handCount = frame.hands.length
          onFrameRef.current(frame)
        } catch (caught) {
          setError(caught instanceof Error ? caught.message : '手势识别运行失败。')
          setStatus('error')
          stopEffects()
          return
        }
      }

      animationFrame = requestAnimationFrame(tick)
    }

    const initialize = async (): Promise<void> => {
      setStatus('loading')
      setError('')
      try {
        const { HandTracker: HandTrackerClass } = await import('../vision/HandTracker')
        const created = await HandTrackerClass.create({ mirrored: true, inputIsMirrored: false })
        if (cancelled) {
          created.dispose()
          return
        }
        tracker = created
        setStatus('ready')
        animationFrame = requestAnimationFrame(tick)
      } catch (caught) {
        if (cancelled) return
        setError(caught instanceof Error ? caught.message : 'MediaPipe 手部模型加载失败。')
        setStatus('error')
      }
    }

    const handleVisibility = (): void => {
      lastInferenceAt = performance.now()
      lastVideoTime = -1
    }
    document.addEventListener('visibilitychange', handleVisibility)
    void initialize()

    return () => {
      cancelled = true
      cancelAnimationFrame(animationFrame)
      document.removeEventListener('visibilitychange', handleVisibility)
      coordinator.reset()
      stopEffects()
      tracker?.dispose()
    }
  }, [cameraReady, enabled, eventBus, metricsRef, retryKey, videoRef])

  const retry = useCallback(() => setRetryKey((key) => key + 1), [])
  return { status, error, retry }
}
