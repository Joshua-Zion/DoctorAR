import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import './App.css'
import { AudioManager, type AudioStatus } from './audio/AudioManager'
import { CameraView } from './components/CameraView'
import { ControlPanel } from './components/ControlPanel'
import { DebugCanvas } from './components/DebugCanvas'
import { DebugPanel } from './components/DebugPanel'
import { EffectStage } from './components/EffectStage'
import { PerformanceHUD } from './components/PerformanceHUD'
import { useCamera } from './hooks/useCamera'
import { useHandTracking } from './hooks/useHandTracking'
import { usePerformanceMonitor } from './hooks/usePerformanceMonitor'
import type { HandFrame } from './types/hand'
import { EMPTY_METRICS, type RuntimeMetrics } from './types/runtime'
import { DEFAULT_SETTINGS, type AppSettings } from './types/settings'
import { GestureEventBus } from './vision/GestureEventBus'

function App() {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS)
  const [cameraRequested, setCameraRequested] = useState(false)
  const [effectError, setEffectError] = useState('')
  const [runtimeNotice, setRuntimeNotice] = useState('')
  const [audioStatus, setAudioStatus] = useState<AudioStatus>('disabled')
  const stageRef = useRef<HTMLDivElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const frameRef = useRef<HandFrame | null>(null)
  const metricsRef = useRef<RuntimeMetrics>({ ...EMPTY_METRICS })
  const eventBus = useMemo(() => new GestureEventBus(), [])
  const audioManager = useMemo(() => new AudioManager(), [])

  useEffect(() => {
    if (!import.meta.env.DEV && !new URLSearchParams(window.location.search).has('doctorar-smoke')) return
    const debugWindow = window as Window & { __DOCTORAR_GESTURE_BUS__?: GestureEventBus }
    debugWindow.__DOCTORAR_GESTURE_BUS__ = eventBus
    return () => {
      delete debugWindow.__DOCTORAR_GESTURE_BUS__
    }
  }, [eventBus])

  const camera = useCamera(videoRef, {
    enabled: cameraRequested,
    cameraId: settings.cameraId,
    resolution: settings.resolution,
  })

  const handleFrame = useCallback((frame: HandFrame): void => {
    frameRef.current = frame
  }, [])

  const tracking = useHandTracking({
    enabled: cameraRequested && settings.trackingEnabled,
    cameraReady: camera.status === 'ready',
    videoRef,
    settings,
    eventBus,
    metricsRef,
    onFrame: handleFrame,
  })

  const metrics = usePerformanceMonitor(metricsRef)

  useEffect(() => {
    const unsubscribe = eventBus.subscribe((event) => audioManager.handle(event))
    return () => {
      unsubscribe()
      audioManager.dispose()
    }
  }, [audioManager, eventBus])

  useEffect(() => audioManager.subscribeStatus(setAudioStatus), [audioManager])

  useEffect(() => {
    audioManager.setEnabled(settings.soundEnabled)
  }, [audioManager, settings.soundEnabled])

  useEffect(() => {
    audioManager.setVolume(settings.soundVolume)
  }, [audioManager, settings.soundVolume])

  useEffect(() => {
    if (!settings.soundEnabled) return

    const retryAudio = (): void => {
      const previousStatus = audioManager.getStatus()
      if (previousStatus !== 'blocked' && previousStatus !== 'suspended') return
      void audioManager.resumeFromUserGesture().then((resumed) => {
        if (resumed) setRuntimeNotice('音效已恢复。')
      })
    }

    window.addEventListener('pointerdown', retryAudio, { capture: true })
    window.addEventListener('keydown', retryAudio, { capture: true })
    return () => {
      window.removeEventListener('pointerdown', retryAudio, { capture: true })
      window.removeEventListener('keydown', retryAudio, { capture: true })
    }
  }, [audioManager, settings.soundEnabled])

  useEffect(() => {
    if (tracking.status === 'ready') return
    frameRef.current = null
    metricsRef.current.handCount = 0
  }, [tracking.status])

  useEffect(() => {
    if (!runtimeNotice) return
    const timer = window.setTimeout(() => setRuntimeNotice(''), 3200)
    return () => window.clearTimeout(timer)
  }, [runtimeNotice])

  const updateSetting = useCallback(<Key extends keyof AppSettings,>(key: Key, value: AppSettings[Key]): void => {
    if (key === 'soundEnabled') {
      const enabled = Boolean(value)
      if (enabled) {
        const unlocking = audioManager.enableFromUserGesture()
        void unlocking.then((unlocked) => {
          if (audioManager.getStatus() === 'disabled') return
          if (unlocked) {
            setRuntimeNotice('音效已开启；听到提示音即表示浏览器解锁成功。')
          } else {
            setRuntimeNotice(audioManager.getStatus() === 'unsupported'
              ? '当前浏览器不支持 Web Audio。'
              : '浏览器暂未允许播放声音，请再点击页面一次。')
          }
        })
      } else {
        audioManager.setEnabled(false)
        setRuntimeNotice('音效已关闭。')
      }
    }
    setSettings((current) => ({ ...current, [key]: value }))
  }, [audioManager])

  const toggleFullscreen = useCallback((): void => {
    const action = document.fullscreenElement
      ? document.exitFullscreen()
      : stageRef.current?.requestFullscreen()
    void action?.catch(() => setRuntimeNotice('浏览器未允许进入全屏，请再次点击。'))
  }, [])

  const handleEffectError = useCallback((message: string): void => setEffectError(message), [])
  const cameraReady = camera.status === 'ready'
  const trackingReady = tracking.status === 'ready'
  const systemReady = cameraReady && (trackingReady || !settings.trackingEnabled)
  const handCount = metrics.handCount

  return (
    <main className="doctor-app">
      <div ref={stageRef} className="ar-stage">
        <CameraView ref={videoRef} />
        <div className="video-vignette" />
        {cameraRequested ? (
          <EffectStage
            eventBus={eventBus}
            settings={settings}
            videoRef={videoRef}
            metricsRef={metricsRef}
            onError={handleEffectError}
          />
        ) : null}
        <DebugCanvas frameRef={frameRef} settings={settings} />

        <div className="ui-layer">
          <div className="brand-lockup" aria-label="DoctorAR">
            <div className="brand-sigil">AR</div>
            <div className="brand-copy"><strong>DOCTOR AR</strong><span>GESTURE ARCANA LAB</span></div>
          </div>

          <div className={`system-status ${systemReady ? 'is-ready' : ''}`}>
            <i />
            <span>{systemReady ? 'LOCAL VISION · ACTIVE' : cameraRequested ? 'SYSTEM INITIALIZING' : 'SYSTEM STANDBY'}</span>
          </div>

          {cameraRequested ? (
            <ControlPanel
              settings={settings}
              devices={camera.devices}
              actualResolution={camera.actualResolution}
              cameraReady={cameraReady}
              audioStatus={audioStatus}
              onChange={updateSetting}
              onFullscreen={toggleFullscreen}
            />
          ) : null}

          {settings.debugEnabled && cameraRequested ? <DebugPanel frameRef={frameRef} metrics={metrics} /> : null}
          <PerformanceHUD metrics={metrics} trackingReady={trackingReady} />

          {trackingReady ? (
            <div className={`gesture-guide ${handCount > 0 ? 'has-hands' : ''}`}>
              <span>✦</span> 张掌唤醒 · 捏合绘制 · 双掌蓄力后快速展开释放冲击波
            </div>
          ) : null}

          {!cameraRequested ? (
            <div className="start-screen">
              <section className="start-ritual">
                <div className="start-orbit" />
                <span className="eyebrow">REAL-TIME GESTURE AR</span>
                <h1>让手势成为<span>秘术</span></h1>
                <p>摄像头画面与手部识别全部在本机浏览器中完成。张开手掌，唤醒属于你的原创几何法阵。</p>
                <button className="start-button" type="button" onClick={() => setCameraRequested(true)}>启动本地视觉系统</button>
                <span className="privacy-note">◈ 不上传画面 · 不依赖云端 AI · 可随时撤回摄像头权限</span>
              </section>
            </div>
          ) : null}

          {cameraRequested && camera.status === 'starting' ? <div className="loading-note"><i />正在申请摄像头并校准画面</div> : null}
          {cameraReady && settings.trackingEnabled && tracking.status === 'loading' ? <div className="loading-note"><i />正在加载本地手部识别模型</div> : null}

          {cameraRequested && camera.status === 'error' ? (
            <div className="start-screen">
              <section className="start-ritual error-card">
                <div className="start-orbit">!</div>
                <span className="eyebrow">CAMERA UNAVAILABLE</span>
                <h1>摄像头<span>未连接</span></h1>
                <p>{camera.error}</p>
                <button className="start-button" type="button" onClick={camera.retry}>重新连接摄像头</button>
              </section>
            </div>
          ) : null}

          {cameraReady && settings.trackingEnabled && tracking.status === 'error' ? (
            <div className="start-screen">
              <section className="start-ritual error-card">
                <div className="start-orbit">!</div>
                <span className="eyebrow">VISION MODEL ERROR</span>
                <h1>识别模块<span>加载失败</span></h1>
                <p>{tracking.error}</p>
                <button className="start-button" type="button" onClick={tracking.retry}>重新加载本地模型</button>
              </section>
            </div>
          ) : null}

          {effectError ? (
            <div className="start-screen">
              <section className="start-ritual error-card">
                <div className="start-orbit">!</div>
                <span className="eyebrow">WEBGL UNAVAILABLE</span>
                <h1>特效层<span>初始化失败</span></h1>
                <p>{effectError} 请确认浏览器已开启硬件加速。</p>
                <button className="start-button" type="button" onClick={() => window.location.reload()}>重新载入页面</button>
              </section>
            </div>
          ) : null}

          {runtimeNotice ? <div className="runtime-toast glass">{runtimeNotice}</div> : null}
        </div>
      </div>
    </main>
  )
}

export default App
