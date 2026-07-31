import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import { RESOLUTION_OPTIONS } from '../config/performanceConfig'
import type { CameraResolution } from '../types/settings'

export type CameraStatus = 'idle' | 'starting' | 'ready' | 'error'

interface UseCameraOptions {
  enabled: boolean
  cameraId: string
  resolution: CameraResolution
}

export interface CameraState {
  status: CameraStatus
  error: string
  devices: MediaDeviceInfo[]
  actualResolution: string
  retry: () => void
}

const cameraErrorMessage = (error: unknown): string => {
  if (error instanceof DOMException) {
    if (error.name === 'NotAllowedError') return '摄像头权限被拒绝。请在浏览器地址栏中允许访问后重试。'
    if (error.name === 'NotFoundError') return '没有找到可用摄像头。请连接设备后重试。'
    if (error.name === 'NotReadableError') return '摄像头正被其他应用占用，或设备暂时不可用。'
    if (error.name === 'OverconstrainedError') return '当前摄像头不支持所选分辨率，请降低清晰度。'
    if (error.name === 'SecurityError') return '摄像头需要 HTTPS 或 localhost 安全环境。'
  }
  return error instanceof Error ? error.message : '无法启动摄像头，请检查设备和浏览器权限。'
}

export const useCamera = (
  videoRef: RefObject<HTMLVideoElement | null>,
  options: UseCameraOptions,
): CameraState => {
  const [status, setStatus] = useState<CameraStatus>('idle')
  const [error, setError] = useState('')
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const [actualResolution, setActualResolution] = useState('—')
  const [retryKey, setRetryKey] = useState(0)
  const streamRef = useRef<MediaStream | null>(null)

  const retry = useCallback(() => setRetryKey((key) => key + 1), [])

  useEffect(() => {
    if (!options.enabled) {
      setStatus('idle')
      return
    }

    let cancelled = false
    const videoElement = videoRef.current
    const stopStream = (stream: MediaStream | null): void => {
      stream?.getTracks().forEach((track) => track.stop())
    }

    const startCamera = async (): Promise<void> => {
      let acquiredStream: MediaStream | null = null
      if (!navigator.mediaDevices?.getUserMedia) {
        setStatus('error')
        setError('当前浏览器不支持摄像头 API，请使用最新版 Chrome 或 Edge。')
        return
      }

      setStatus('starting')
      setError('')
      stopStream(streamRef.current)
      streamRef.current = null

      const selected = RESOLUTION_OPTIONS.find((item) => item.value === options.resolution) ?? RESOLUTION_OPTIONS[1]
      const videoConstraints: MediaTrackConstraints = {
        width: { ideal: selected.width },
        height: { ideal: selected.height },
        frameRate: { ideal: 60, min: 24 },
        ...(options.cameraId ? { deviceId: { exact: options.cameraId } } : { facingMode: 'user' }),
      }

      try {
        let stream: MediaStream
        try {
          stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: videoConstraints })
        } catch (firstError) {
          if (!(firstError instanceof DOMException) || firstError.name !== 'OverconstrainedError') throw firstError
          stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: true })
        }
        acquiredStream = stream

        if (cancelled) {
          stopStream(stream)
          return
        }

        streamRef.current = stream
        const video = videoElement
        if (!video) throw new Error('摄像头画面尚未准备好。')
        video.srcObject = stream
        await video.play()
        if (cancelled) {
          if (video.srcObject === stream) video.srcObject = null
          stopStream(stream)
          return
        }

        const trackSettings = stream.getVideoTracks()[0]?.getSettings()
        const width = trackSettings?.width ?? video.videoWidth
        const height = trackSettings?.height ?? video.videoHeight
        const available = await navigator.mediaDevices.enumerateDevices()
        if (cancelled) {
          if (video.srcObject === stream) video.srcObject = null
          stopStream(stream)
          return
        }
        setActualResolution(width && height ? `${width} × ${height}` : '自动')
        setDevices(available.filter((device) => device.kind === 'videoinput'))
        setStatus('ready')
      } catch (caught) {
        stopStream(acquiredStream)
        if (videoElement?.srcObject === acquiredStream) videoElement.srcObject = null
        if (streamRef.current === acquiredStream) streamRef.current = null
        if (cancelled) return
        setStatus('error')
        setError(cameraErrorMessage(caught))
      }
    }

    void startCamera()
    return () => {
      cancelled = true
      stopStream(streamRef.current)
      streamRef.current = null
      if (videoElement) videoElement.srcObject = null
    }
  }, [options.cameraId, options.enabled, options.resolution, retryKey, videoRef])

  return { status, error, devices, actualResolution, retry }
}
