import { useState } from 'react'
import type { AudioStatus } from '../audio/AudioManager'
import { THEME_LIST } from '../config/effectThemes'
import { PERFORMANCE_PRESETS, RESOLUTION_OPTIONS } from '../config/performanceConfig'
import type { AppSettings, PerformanceMode } from '../types/settings'

interface ControlPanelProps {
  settings: AppSettings
  devices: MediaDeviceInfo[]
  actualResolution: string
  cameraReady: boolean
  audioStatus: AudioStatus
  onChange: <Key extends keyof AppSettings>(key: Key, value: AppSettings[Key]) => void
  onFullscreen: () => void
}

interface ToggleProps {
  label: string
  hint?: string
  checked: boolean
  onChange: (checked: boolean) => void
}

const Toggle = ({ label, hint, checked, onChange }: ToggleProps) => (
  <label className="toggle-row">
    <span>
      <strong>{label}</strong>
      {hint ? <small>{hint}</small> : null}
    </span>
    <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
    <span className="toggle-track" aria-hidden="true"><span /></span>
  </label>
)

const AUDIO_STATUS_COPY: Record<AudioStatus, string> = {
  disabled: '音效关闭',
  unlocking: '正在解锁浏览器音频…',
  ready: '音频已解锁 · 手势会发声',
  suspended: '音频已暂停 · 点击页面恢复',
  blocked: '浏览器阻止播放 · 再点击页面重试',
  unsupported: '当前浏览器不支持 Web Audio',
}

interface RangeProps {
  label: string
  value: number
  min: number
  max: number
  step: number
  display: string
  onChange: (value: number) => void
}

const Range = ({ label, value, min, max, step, display, onChange }: RangeProps) => {
  const progress = ((value - min) / (max - min)) * 100
  return (
    <label className="range-control">
      <span><strong>{label}</strong><output>{display}</output></span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        style={{ '--range-progress': `${progress}%` } as React.CSSProperties}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  )
}

export const ControlPanel = ({
  settings,
  devices,
  actualResolution,
  cameraReady,
  audioStatus,
  onChange,
  onFullscreen,
}: ControlPanelProps) => {
  const [collapsed, setCollapsed] = useState(false)

  if (collapsed) {
    return (
      <button className="panel-reopen glass" type="button" onClick={() => setCollapsed(false)} aria-label="展开控制面板">
        <span>⌁</span>
        <span>控制台</span>
      </button>
    )
  }

  return (
    <aside className="control-panel glass" aria-label="DoctorAR 控制面板">
      <header className="panel-header">
        <div>
          <span className="eyebrow">ARCANE INTERFACE</span>
          <h2>控制台</h2>
        </div>
        <button type="button" className="icon-button" onClick={() => setCollapsed(true)} aria-label="收起控制面板">›</button>
      </header>

      <div className="panel-scroll">
        <section className="panel-section">
          <div className="section-title"><span>01</span><h3>感知系统</h3></div>
          <Toggle label="手势识别" hint="MediaPipe · 本地推理" checked={settings.trackingEnabled} onChange={(value) => onChange('trackingEnabled', value)} />
          <div className="toggle-pair">
            <Toggle label="关键点" checked={settings.showLandmarks} onChange={(value) => onChange('showLandmarks', value)} />
            <Toggle label="骨架" checked={settings.showConnections} onChange={(value) => onChange('showConnections', value)} />
          </div>
          <Range label="手势灵敏度" value={settings.gestureSensitivity} min={0.35} max={0.85} step={0.01} display={`${Math.round(settings.gestureSensitivity * 100)}%`} onChange={(value) => onChange('gestureSensitivity', value)} />
          <Range label="坐标平滑" value={settings.smoothing} min={0.25} max={0.9} step={0.01} display={`${Math.round(settings.smoothing * 100)}%`} onChange={(value) => onChange('smoothing', value)} />
          <Range label="触发冷却" value={settings.cooldownMs} min={300} max={1500} step={20} display={`${settings.cooldownMs} ms`} onChange={(value) => onChange('cooldownMs', value)} />
        </section>

        <section className="panel-section">
          <div className="section-title"><span>02</span><h3>秘术渲染</h3></div>
          <div className="toggle-pair">
            <Toggle label="魔法阵" checked={settings.effectsEnabled} onChange={(value) => onChange('effectsEnabled', value)} />
            <Toggle label="粒子" checked={settings.particlesEnabled} onChange={(value) => onChange('particlesEnabled', value)} />
          </div>
          <div className="theme-control">
            <div className="field-label"><strong>能量主题</strong><span>{THEME_LIST.find((theme) => theme.id === settings.theme)?.label}</span></div>
            <div className="theme-grid">
              {THEME_LIST.map((theme) => (
                <button
                  type="button"
                  key={theme.id}
                  className={settings.theme === theme.id ? 'is-active' : ''}
                  style={{ '--theme-color': theme.css } as React.CSSProperties}
                  onClick={() => onChange('theme', theme.id)}
                  title={theme.label}
                  aria-label={theme.label}
                  aria-pressed={settings.theme === theme.id}
                ><span /></button>
              ))}
            </div>
          </div>
          <Range label="法阵尺寸" value={settings.effectScale} min={0.65} max={1.5} step={0.01} display={`${Math.round(settings.effectScale * 100)}%`} onChange={(value) => onChange('effectScale', value)} />
          <Range label="能量亮度" value={settings.brightness} min={0.4} max={1.6} step={0.01} display={`${Math.round(settings.brightness * 100)}%`} onChange={(value) => onChange('brightness', value)} />
          <Range label="粒子密度" value={settings.particleAmount} min={0.15} max={1} step={0.01} display={`${Math.round(settings.particleAmount * 100)}%`} onChange={(value) => onChange('particleAmount', value)} />
          <Range label="粒子速度" value={settings.particleSpeed} min={0.5} max={1.8} step={0.01} display={`${settings.particleSpeed.toFixed(1)}×`} onChange={(value) => onChange('particleSpeed', value)} />
          <Toggle label="合成音效" hint="开启后会播放一声确认音" checked={settings.soundEnabled} onChange={(value) => onChange('soundEnabled', value)} />
          <div
            className={`audio-status is-${audioStatus}`}
            data-audio-status={audioStatus}
            role="status"
            aria-live="polite"
          >
            <i aria-hidden="true" />
            <span>{AUDIO_STATUS_COPY[audioStatus]}</span>
          </div>
          <Range label="音效音量" value={settings.soundVolume} min={0.05} max={0.6} step={0.01} display={`${Math.round(settings.soundVolume * 100)}%`} onChange={(value) => onChange('soundVolume', value)} />
        </section>

        <section className="panel-section">
          <div className="section-title"><span>03</span><h3>设备与性能</h3></div>
          <label className="select-control">
            <span>摄像头</span>
            <select value={settings.cameraId} onChange={(event) => onChange('cameraId', event.target.value)}>
              <option value="">系统默认摄像头</option>
              {devices.map((device, index) => <option key={device.deviceId} value={device.deviceId}>{device.label || `摄像头 ${index + 1}`}</option>)}
            </select>
          </label>
          <label className="select-control">
            <span>目标分辨率 <em>{cameraReady ? `实际 ${actualResolution}` : ''}</em></span>
            <select value={settings.resolution} onChange={(event) => onChange('resolution', event.target.value as AppSettings['resolution'])}>
              {RESOLUTION_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
          <div className="field-label"><strong>性能模式</strong><span>{PERFORMANCE_PRESETS[settings.performanceMode].label}</span></div>
          <div className="segmented-control">
            {(Object.keys(PERFORMANCE_PRESETS) as PerformanceMode[]).map((mode) => (
              <button type="button" key={mode} className={settings.performanceMode === mode ? 'is-active' : ''} onClick={() => onChange('performanceMode', mode)}>
                {PERFORMANCE_PRESETS[mode].label}
              </button>
            ))}
          </div>
          <div className="toggle-pair">
            <Toggle label="调试模式" checked={settings.debugEnabled} onChange={(value) => onChange('debugEnabled', value)} />
            <button type="button" className="action-button" onClick={onFullscreen}><span>⛶</span> 全屏</button>
          </div>
        </section>
      </div>
      <footer className="panel-footer"><span className="privacy-mark">◈</span><span>画面仅在此设备处理<br /><small>不会上传任何摄像头帧</small></span></footer>
    </aside>
  )
}
