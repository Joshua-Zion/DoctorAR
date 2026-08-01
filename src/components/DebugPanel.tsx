import { useEffect, useState, type RefObject } from 'react'
import type { HandFrame } from '../types/hand'
import type { RuntimeMetrics } from '../types/runtime'

interface DebugPanelProps {
  frameRef: RefObject<HandFrame | null>
  metrics: RuntimeMetrics
}

const format = (value: number, digits = 2): string => value.toFixed(digits)

export const DebugPanel = ({ frameRef, metrics }: DebugPanelProps) => {
  const [frame, setFrame] = useState<HandFrame | null>(null)

  useEffect(() => {
    const timer = window.setInterval(() => setFrame(frameRef.current), 180)
    return () => window.clearInterval(timer)
  }, [frameRef])

  return (
    <aside className="debug-panel glass" aria-label="手势调试信息">
      <div className="debug-heading"><span>LIVE TELEMETRY</span><strong>调试数据</strong></div>
      <dl className="debug-grid">
        <div><dt>FPS</dt><dd>{metrics.fps || '—'}</dd></div>
        <div><dt>推理</dt><dd>{format(metrics.inferenceMs, 1)} ms</dd></div>
        <div><dt>推理频率</dt><dd>{format(metrics.inferenceFps, 1)} FPS</dd></div>
        <div><dt>视觉后端</dt><dd>{metrics.visionBackend === 'worker' ? 'WORKER' : metrics.visionBackend === 'main' ? 'MAIN' : '—'}</dd></div>
        <div><dt>往返延迟</dt><dd>{format(metrics.workerRoundTripMs, 1)} ms</dd></div>
        <div><dt>跳过帧</dt><dd>{metrics.droppedInferenceFrames}</dd></div>
        <div><dt>渲染</dt><dd>{format(metrics.renderMs, 1)} ms</dd></div>
        <div><dt>粒子</dt><dd>{metrics.activeParticles}</dd></div>
        <div><dt>轨迹段</dt><dd>{metrics.activeTrailSegments}</dd></div>
        <div><dt>冲击波</dt><dd>{metrics.activeShockwaves}</dd></div>
        <div><dt>Draw calls</dt><dd>{metrics.drawCalls}</dd></div>
        <div><dt>双手距离</dt><dd>{frame?.twoHand ? format(frame.twoHand.distance, 3) : '—'}</dd></div>
        <div><dt>距离速度</dt><dd>{frame?.twoHand ? `${format(frame.twoHand.distanceVelocity, 2)}/s` : '—'}</dd></div>
        <div><dt>输入</dt><dd>{frame ? `${frame.videoWidth}×${frame.videoHeight}` : '—'}</dd></div>
      </dl>
      <div className="hand-debug-list">
        {frame?.hands.length ? frame.hands.map((hand) => (
          <article key={hand.handedness}>
            <header><strong>{hand.handedness === 'left' ? '左手' : '右手'}</strong><span>{hand.gesture.toUpperCase()}</span></header>
            <p>分类置信 {Math.round(hand.handednessConfidence * 100)}% · 追踪质量 {Math.round(hand.trackingQuality * 100)}%</p>
            <p>中心 {format(hand.palm.center.x)}, {format(hand.palm.center.y)} · 掌宽 {format(hand.palm.width, 3)}</p>
            <p>速度 {format(hand.speed, 2)}/s · 朝向 {format(hand.palm.facingScore)}</p>
            <div className="score-bars">
              <span style={{ '--score': `${hand.scores.open * 100}%` } as React.CSSProperties}>OPEN</span>
              <span style={{ '--score': `${hand.scores.fist * 100}%` } as React.CSSProperties}>FIST</span>
              <span style={{ '--score': `${hand.scores.pinch * 100}%` } as React.CSSProperties}>PINCH</span>
            </div>
          </article>
        )) : <p className="debug-empty">等待手部进入画面…</p>}
      </div>
    </aside>
  )
}
