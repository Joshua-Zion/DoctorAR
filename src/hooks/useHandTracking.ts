import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import { PERFORMANCE_PRESETS, type PerformancePreset } from '../config/performanceConfig'
import type { HandFrame } from '../types/hand'
import type { RuntimeMetrics } from '../types/runtime'
import type { AppSettings } from '../types/settings'
import { GestureCoordinator } from '../vision/GestureCoordinator'
import type { GestureEventBus } from '../vision/GestureEventBus'
import { HandTrackingClient, type HandTrackingResult } from '../vision/HandTrackingClient'
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

const FALLBACK_MAX_FPS = 18

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
    const metrics = metricsRef.current
    if (!enabled || !cameraReady) {
      metrics.visionBackend = 'idle'
      setStatus('idle')
      return
    }

    const initializationController = new AbortController()
    const coordinator = new GestureCoordinator(eventBus)
    let cancelled = false
    let runtimeFailed = false
    let fallbackAttempted = false
    let animationFrame = 0
    let videoFrameCallback = 0
    let scheduledVideo: HTMLVideoElement | null = null
    let client: HandTrackingClient | null = null
    let fallbackTracker: HandTracker | null = null
    let fallbackCanvas: HTMLCanvasElement | null = null
    let fallbackContext: CanvasRenderingContext2D | null = null
    let capturePending = false
    let captureEpoch = 0
    let lastVideoTime = -1
    let lastInferenceAt = 0
    let inferenceCount = 0
    let inferenceWindowStarted = performance.now()

    const stopEffects = (): void => {
      eventBus.emit({ type: 'HAND_LOST', hand: 'left' })
      eventBus.emit({ type: 'HAND_LOST', hand: 'right' })
      eventBus.emit({ type: 'TWO_HAND_CHARGE_END' })
    }

    const cancelFramePump = (): void => {
      if (animationFrame) cancelAnimationFrame(animationFrame)
      animationFrame = 0
      if (
        scheduledVideo &&
        videoFrameCallback &&
        typeof scheduledVideo.cancelVideoFrameCallback === 'function'
      ) {
        scheduledVideo.cancelVideoFrameCallback(videoFrameCallback)
      }
      videoFrameCallback = 0
      scheduledVideo = null
    }

    const reportFrame = (frame: HandFrame, roundTripMs: number): void => {
      if (cancelled || runtimeFailed || document.hidden) return
      const currentSettings = settingsRef.current
      coordinator.process(frame, {
        sensitivity: currentSettings.gestureSensitivity,
        cooldownMs: currentSettings.cooldownMs,
      })
      const currentMetrics = metricsRef.current
      currentMetrics.inferenceMs = frame.inferenceMs
      currentMetrics.workerRoundTripMs = roundTripMs
      currentMetrics.handCount = frame.hands.length
      inferenceCount += 1
      const elapsed = performance.now() - inferenceWindowStarted
      if (elapsed >= 500) {
        currentMetrics.inferenceFps = (inferenceCount * 1000) / elapsed
        inferenceCount = 0
        inferenceWindowStarted = performance.now()
      }
      onFrameRef.current(frame)
    }

    const failPermanently = (message: string): void => {
      if (cancelled) return
      runtimeFailed = true
      captureEpoch += 1
      cancelFramePump()
      coordinator.reset()
      stopEffects()
      client?.dispose()
      client = null
      fallbackTracker?.dispose()
      fallbackTracker = null
      fallbackCanvas = null
      fallbackContext = null
      metricsRef.current.visionBackend = 'idle'
      setError(message)
      setStatus('error')
    }

    const loadFallbackTracker = async (): Promise<HandTracker> => {
      const { HandTracker: HandTrackerClass } = await import('../vision/HandTracker')
      return HandTrackerClass.create({ mirrored: true, inputIsMirrored: false })
    }

    const switchToMainThreadFallback = async (reason: string): Promise<void> => {
      if (cancelled || runtimeFailed || fallbackAttempted) {
        if (!cancelled && !runtimeFailed) failPermanently(reason)
        return
      }

      fallbackAttempted = true
      runtimeFailed = true
      captureEpoch += 1
      cancelFramePump()
      coordinator.reset()
      stopEffects()
      const failedClient = client
      client = null
      failedClient?.dispose()
      metricsRef.current.visionBackend = 'idle'
      setStatus('loading')
      setError('')
      console.warn('Vision Worker runtime failed; falling back to main-thread inference.', reason)

      try {
        const created = await loadFallbackTracker()
        if (cancelled) {
          created.dispose()
          return
        }
        fallbackTracker = created
        lastVideoTime = -1
        lastInferenceAt = performance.now()
        metricsRef.current.visionBackend = 'main'
        runtimeFailed = false
        setStatus('ready')
        scheduleNextFrame()
      } catch (caught) {
        failPermanently(caught instanceof Error ? caught.message : reason)
      }
    }

    const handleWorkerResult = (result: HandTrackingResult): void => reportFrame(result.frame, result.roundTripMs)

    const handleRuntimeFailure = (message: string): void => {
      if (cancelled || runtimeFailed) return
      if (!fallbackAttempted && !fallbackTracker) {
        void switchToMainThreadFallback(message)
        return
      }
      failPermanently(message)
    }

    const captureForWorker = async (
      video: HTMLVideoElement,
      now: number,
      preset: PerformancePreset,
    ): Promise<void> => {
      const targetClient = client
      if (!targetClient || capturePending || targetClient.busy || runtimeFailed) return
      capturePending = true
      const epoch = captureEpoch
      const capturedVideoTime = video.currentTime
      const sourceWidth = Math.max(1, video.videoWidth)
      const sourceHeight = Math.max(1, video.videoHeight)
      const scale = Math.min(1, preset.inferenceLongEdge / Math.max(sourceWidth, sourceHeight))
      const resizeWidth = Math.max(1, Math.round(sourceWidth * scale))
      const resizeHeight = Math.max(1, Math.round(sourceHeight * scale))

      try {
        const bitmap = await createImageBitmap(video, {
          resizeWidth,
          resizeHeight,
          resizeQuality: 'low',
        })
        if (
          cancelled ||
          runtimeFailed ||
          document.hidden ||
          epoch !== captureEpoch ||
          client !== targetClient ||
          videoRef.current !== video
        ) {
          bitmap.close()
          return
        }
        const currentSettings = settingsRef.current
        const submitted = targetClient.submit(bitmap, {
          timestamp: now,
          videoWidth: sourceWidth,
          videoHeight: sourceHeight,
          smoothing: currentSettings.smoothing,
          sensitivity: currentSettings.gestureSensitivity,
        })
        if (!submitted) {
          metricsRef.current.droppedInferenceFrames += 1
          if (!targetClient.busy) handleRuntimeFailure('无法将摄像头帧发送到识别 Worker。')
          return
        }
        lastVideoTime = capturedVideoTime
        lastInferenceAt = now
      } catch (caught) {
        if (!cancelled && !document.hidden && epoch === captureEpoch) {
          handleRuntimeFailure(caught instanceof Error ? caught.message : '无法将摄像头帧发送到识别 Worker。')
        }
      } finally {
        capturePending = false
      }
    }

    const processVideoFrame = (now: number): void => {
      if (cancelled || runtimeFailed) return
      scheduleNextFrame()
      const video = videoRef.current
      const currentSettings = settingsRef.current
      if (
        document.hidden ||
        !currentSettings.trackingEnabled ||
        !video ||
        video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA ||
        video.currentTime === lastVideoTime
      ) return

      const preset = PERFORMANCE_PRESETS[currentSettings.performanceMode]
      const inferenceFps = fallbackTracker ? Math.min(preset.inferenceFps, FALLBACK_MAX_FPS) : preset.inferenceFps
      const minimumInterval = 1000 / inferenceFps
      if (now - lastInferenceAt < minimumInterval) return

      if (client) {
        if (capturePending || client.busy) {
          metricsRef.current.droppedInferenceFrames += 1
          return
        }
        void captureForWorker(video, now, preset)
        return
      }

      if (!fallbackTracker) return
      try {
        const sourceWidth = Math.max(1, video.videoWidth)
        const sourceHeight = Math.max(1, video.videoHeight)
        const fallbackLongEdge = PERFORMANCE_PRESETS.low.inferenceLongEdge
        const fallbackScale = Math.min(1, fallbackLongEdge / Math.max(sourceWidth, sourceHeight))
        const fallbackWidth = Math.max(1, Math.round(sourceWidth * fallbackScale))
        const fallbackHeight = Math.max(1, Math.round(sourceHeight * fallbackScale))
        if (!fallbackCanvas) {
          fallbackCanvas = document.createElement('canvas')
          fallbackContext = fallbackCanvas.getContext('2d', { alpha: false })
        }
        if (!fallbackContext || !fallbackCanvas) throw new Error('无法创建主线程识别画布。')
        if (fallbackCanvas.width !== fallbackWidth) fallbackCanvas.width = fallbackWidth
        if (fallbackCanvas.height !== fallbackHeight) fallbackCanvas.height = fallbackHeight
        fallbackContext.drawImage(video, 0, 0, fallbackWidth, fallbackHeight)
        const startedAt = performance.now()
        const frame = fallbackTracker.detectSource(
          fallbackCanvas,
          now,
          sourceWidth,
          sourceHeight,
          currentSettings.smoothing,
          currentSettings.gestureSensitivity,
        )
        lastVideoTime = video.currentTime
        lastInferenceAt = now
        reportFrame(frame, performance.now() - startedAt)
      } catch (caught) {
        handleRuntimeFailure(caught instanceof Error ? caught.message : '手势识别运行失败。')
      }
    }

    const scheduleNextFrame = (): void => {
      if (cancelled || runtimeFailed || animationFrame || videoFrameCallback) return
      const video = videoRef.current
      if (video && typeof video.requestVideoFrameCallback === 'function') {
        scheduledVideo = video
        videoFrameCallback = video.requestVideoFrameCallback((now) => {
          videoFrameCallback = 0
          scheduledVideo = null
          processVideoFrame(now)
        })
      } else {
        animationFrame = requestAnimationFrame((now) => {
          animationFrame = 0
          processVideoFrame(now)
        })
      }
    }

    const initialize = async (): Promise<void> => {
      setStatus('loading')
      setError('')
      metrics.visionBackend = 'idle'
      metrics.droppedInferenceFrames = 0

      const supportsWorkerTransport = typeof Worker !== 'undefined' && typeof createImageBitmap === 'function'
      let workerError: unknown = supportsWorkerTransport
        ? null
        : new Error('当前浏览器不支持摄像头帧 Worker 传输。')

      if (supportsWorkerTransport) {
        try {
          const created = await HandTrackingClient.create({
            onResult: handleWorkerResult,
            onError: handleRuntimeFailure,
          }, initializationController.signal)
          if (cancelled) {
            created.dispose()
            return
          }
          client = created
          metricsRef.current.visionBackend = 'worker'
        } catch (caught) {
          workerError = caught
          if (cancelled) return
        }
      }

      if (!client) {
        console.warn('Vision Worker unavailable; falling back to main-thread inference.', workerError)
        fallbackAttempted = true
        try {
          const created = await loadFallbackTracker()
          if (cancelled) {
            created.dispose()
            return
          }
          fallbackTracker = created
          metricsRef.current.visionBackend = 'main'
        } catch (caught) {
          if (cancelled) return
          failPermanently(caught instanceof Error ? caught.message : 'MediaPipe 手部模型加载失败。')
          return
        }
      }

      setStatus('ready')
      scheduleNextFrame()
    }

    const handleVisibility = (): void => {
      captureEpoch += 1
      lastInferenceAt = performance.now()
      lastVideoTime = -1
      if (document.hidden) {
        cancelFramePump()
        coordinator.reset()
        client?.reset()
        fallbackTracker?.reset()
        metrics.handCount = 0
        stopEffects()
      } else if (!runtimeFailed && (client || fallbackTracker)) {
        scheduleNextFrame()
      }
    }
    document.addEventListener('visibilitychange', handleVisibility)
    void initialize()

    return () => {
      cancelled = true
      runtimeFailed = true
      captureEpoch += 1
      initializationController.abort()
      cancelFramePump()
      document.removeEventListener('visibilitychange', handleVisibility)
      coordinator.reset()
      stopEffects()
      client?.dispose()
      fallbackTracker?.dispose()
      fallbackCanvas = null
      fallbackContext = null
      metrics.visionBackend = 'idle'
    }
  }, [cameraReady, enabled, eventBus, metricsRef, retryKey, videoRef])

  const retry = useCallback(() => setRetryKey((key) => key + 1), [])
  return { status, error, retry }
}
