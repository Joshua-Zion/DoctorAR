import { useEffect, useRef, type RefObject } from 'react'
import { EFFECT_THEMES } from '../config/effectThemes'
import type { HandFrame, Vector2Like } from '../types/hand'
import type { AppSettings } from '../types/settings'
import { CoordinateMapper } from '../vision/CoordinateMapper'

const CONNECTIONS: ReadonlyArray<readonly [number, number]> = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20], [17, 0],
]

interface DebugCanvasProps {
  frameRef: RefObject<HandFrame | null>
  settings: AppSettings
}

export const DebugCanvas = ({ frameRef, settings }: DebugCanvasProps) => {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const settingsRef = useRef(settings)
  const active = settings.showLandmarks || settings.showConnections || settings.debugEnabled
  settingsRef.current = settings

  useEffect(() => {
    const canvas = canvasRef.current
    const parent = canvas?.parentElement
    if (!canvas || !parent) return

    const context = canvas.getContext('2d')
    if (!context) return
    if (!active) {
      context.clearRect(0, 0, canvas.width, canvas.height)
      return
    }
    const mapper = new CoordinateMapper({ mirrored: true })
    let width = 1
    let height = 1
    let animationFrame = 0

    const resize = (): void => {
      const rect = parent.getBoundingClientRect()
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      width = Math.max(1, rect.width)
      height = Math.max(1, rect.height)
      canvas.width = Math.round(width * dpr)
      canvas.height = Math.round(height * dpr)
      context.setTransform(dpr, 0, 0, dpr, 0, 0)
    }

    const point = (value: Vector2Like): Vector2Like => mapper.mapToDisplay(value, width, height)

    const draw = (): void => {
      context.clearRect(0, 0, width, height)
      const currentSettings = settingsRef.current
      const shouldDrawPoints = currentSettings.showLandmarks || currentSettings.debugEnabled
      const shouldDrawBones = currentSettings.showConnections || currentSettings.debugEnabled
      const frame = frameRef.current

      if (frame && (shouldDrawPoints || shouldDrawBones)) {
        mapper.setVideoSize(frame.videoWidth, frame.videoHeight)
        const theme = EFFECT_THEMES[currentSettings.theme]
        const accent = theme.css

        for (const hand of frame.hands) {
          if (shouldDrawBones) {
            context.beginPath()
            for (const [fromIndex, toIndex] of CONNECTIONS) {
              const from = point(hand.landmarks[fromIndex])
              const to = point(hand.landmarks[toIndex])
              context.moveTo(from.x, from.y)
              context.lineTo(to.x, to.y)
            }
            context.strokeStyle = `${accent}99`
            context.lineWidth = 1.25
            context.shadowColor = accent
            context.shadowBlur = 5
            context.stroke()
            context.shadowBlur = 0
          }

          if (shouldDrawPoints) {
            hand.landmarks.forEach((landmark, index) => {
              const display = point(landmark)
              context.beginPath()
              context.arc(display.x, display.y, index === 0 || index % 4 === 0 ? 3.2 : 2.1, 0, Math.PI * 2)
              context.fillStyle = index % 4 === 0 ? '#fff4d6' : accent
              context.fill()
            })
          }

          if (currentSettings.debugEnabled) {
            const center = point(hand.palm.center)
            context.beginPath()
            context.arc(center.x, center.y, 7, 0, Math.PI * 2)
            context.strokeStyle = '#ffffffcc'
            context.lineWidth = 1
            context.stroke()
            context.fillStyle = 'rgba(7, 7, 6, .78)'
            context.fillRect(center.x + 11, center.y - 18, 92, 30)
            context.fillStyle = '#ffe2b2'
            context.font = '600 9px ui-monospace, monospace'
            context.fillText(`${hand.handedness.toUpperCase()} · ${hand.gesture.toUpperCase()}`, center.x + 16, center.y - 6)
            context.fillStyle = 'rgba(255, 226, 178, .55)'
            context.font = '8px ui-monospace, monospace'
            context.fillText(`OPEN ${Math.round(hand.scores.open * 100)}  FIST ${Math.round(hand.scores.fist * 100)}`, center.x + 16, center.y + 5)
          }
        }

        if (currentSettings.debugEnabled && frame.twoHand && frame.hands.length === 2) {
          const first = point(frame.hands[0].palm.center)
          const second = point(frame.hands[1].palm.center)
          context.setLineDash([4, 5])
          context.beginPath()
          context.moveTo(first.x, first.y)
          context.lineTo(second.x, second.y)
          context.strokeStyle = `${accent}aa`
          context.stroke()
          context.setLineDash([])
        }
      }

      animationFrame = requestAnimationFrame(draw)
    }

    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(parent)
    animationFrame = requestAnimationFrame(draw)
    return () => {
      observer.disconnect()
      cancelAnimationFrame(animationFrame)
    }
  }, [active, frameRef])

  return <canvas ref={canvasRef} className="debug-layer" aria-hidden="true" />
}
