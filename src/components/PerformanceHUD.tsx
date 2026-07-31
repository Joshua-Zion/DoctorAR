import type { RuntimeMetrics } from '../types/runtime'

interface PerformanceHUDProps {
  metrics: RuntimeMetrics
  trackingReady: boolean
}

export const PerformanceHUD = ({ metrics, trackingReady }: PerformanceHUDProps) => (
  <div className="performance-hud" aria-label="性能信息">
    <span className={`perf-dot ${trackingReady ? 'is-ready' : ''}`} />
    <span>{metrics.fps || '—'} FPS</span>
    <i />
    <span>AI {trackingReady ? `${metrics.inferenceMs.toFixed(1)} ms` : '待命'}</span>
    <i />
    <span>{metrics.activeParticles} 粒子</span>
  </div>
)
