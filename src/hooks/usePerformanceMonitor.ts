import { useEffect, useState, type RefObject } from 'react'
import { EMPTY_METRICS, type RuntimeMetrics } from '../types/runtime'

export const usePerformanceMonitor = (metricsRef: RefObject<RuntimeMetrics>): RuntimeMetrics => {
  const [snapshot, setSnapshot] = useState<RuntimeMetrics>(EMPTY_METRICS)

  useEffect(() => {
    let frameCount = 0
    let lastSample = performance.now()
    let animationFrame = 0

    const tick = (): void => {
      frameCount += 1
      animationFrame = requestAnimationFrame(tick)
    }
    animationFrame = requestAnimationFrame(tick)

    const interval = window.setInterval(() => {
      const now = performance.now()
      const elapsed = Math.max(1, now - lastSample)
      const metrics = metricsRef.current
      setSnapshot({ ...metrics, fps: Math.round((frameCount * 1000) / elapsed) })
      frameCount = 0
      lastSample = now
    }, 500)

    return () => {
      cancelAnimationFrame(animationFrame)
      window.clearInterval(interval)
    }
  }, [metricsRef])

  return snapshot
}
