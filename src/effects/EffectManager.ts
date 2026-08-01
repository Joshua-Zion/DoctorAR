import * as THREE from 'three'
import { EFFECT_THEMES } from '../config/effectThemes'
import { GESTURE_CONFIG } from '../config/gestureConfig'
import { PERFORMANCE_PRESETS } from '../config/performanceConfig'
import type { EffectRuntimeSettings, EffectStats } from '../types/effect'
import type { GestureEvent, GesturePose } from '../types/gesture'
import type { Handedness, Vector3Like } from '../types/hand'
import { DEFAULT_SETTINGS } from '../types/settings'
import { clamp } from '../utils/math'
import { MagicCircleEffect, type MagicCircleTarget } from './MagicCircleEffect'
import { ParticleSystem } from './ParticleSystem'
import { PinchTrailEffect } from './PinchTrailEffect'
import { ShockwaveEffect } from './ShockwaveEffect'

export interface GestureEventSource {
  subscribe(listener: (event: GestureEvent) => void): () => void
}

export type EffectCoordinateSpace = 'normalized' | 'screen'
export type VideoFitMode = 'cover' | 'contain' | 'stretch'

const DEFAULT_RUNTIME_SETTINGS: EffectRuntimeSettings = {
  enabled: DEFAULT_SETTINGS.effectsEnabled,
  particlesEnabled: DEFAULT_SETTINGS.particlesEnabled,
  theme: DEFAULT_SETTINGS.theme,
  scale: DEFAULT_SETTINGS.effectScale,
  brightness: DEFAULT_SETTINGS.brightness,
  particleAmount: DEFAULT_SETTINGS.particleAmount,
  particleSpeed: DEFAULT_SETTINGS.particleSpeed,
  performanceMode: DEFAULT_SETTINGS.performanceMode,
}

const MAX_PARTICLES = Math.max(
  PERFORMANCE_PRESETS.low.particleLimit,
  PERFORMANCE_PRESETS.balanced.particleLimit,
  PERFORMANCE_PRESETS.high.particleLimit,
)

/**
 * Owns the one transparent WebGL layer used by all V1 effects. Gesture data is
 * consumed through a structural event source, keeping this module independent
 * from the concrete vision event-bus implementation.
 */
export class EffectManager {
  private readonly renderer: THREE.WebGLRenderer
  private readonly scene = new THREE.Scene()
  private readonly camera = new THREE.OrthographicCamera(-0.5, 0.5, 0.5, -0.5, 0.1, 2000)
  private readonly particles: ParticleSystem
  private readonly pinchTrails: PinchTrailEffect
  private readonly shockwaves: ShockwaveEffect
  private readonly circles: Record<'left' | 'right' | 'dual', MagicCircleEffect>
  private readonly unsubscribeEvents: () => void
  private readonly onStats?: (stats: EffectStats) => void
  private readonly mappedPoint = { x: 0, y: 0 }
  private readonly activePinches = new Set<Handedness>()
  private readonly blockedPinches = new Set<Handedness>()

  private resizeObserver: ResizeObserver | null = null
  private settings: EffectRuntimeSettings = { ...DEFAULT_RUNTIME_SETTINGS }
  private coordinateSpace: EffectCoordinateSpace = 'normalized'
  private mirrorNormalizedX = false
  private videoFit: VideoFitMode = 'stretch'
  private sourceWidth = 0
  private sourceHeight = 0
  private width = 0
  private height = 0
  private pixelRatio = 0
  private running = false
  private disposed = false
  private lastFrameTime = 0
  private lastStatsTime = 0
  private lastDualDiameter = 180
  private dualActive = false

  constructor(canvas: HTMLCanvasElement, eventBus: GestureEventSource, onStats?: (stats: EffectStats) => void) {
    this.onStats = onStats
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: true,
      antialias: false,
      depth: false,
      stencil: false,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: false,
    })
    this.renderer.setClearColor(0x000000, 0)
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.camera.position.z = 1000

    const initialTheme = EFFECT_THEMES[this.settings.theme]
    this.particles = new ParticleSystem(this.scene, MAX_PARTICLES)
    this.pinchTrails = new PinchTrailEffect(this.scene, initialTheme)
    this.shockwaves = new ShockwaveEffect(this.scene, initialTheme)
    this.circles = {
      left: new MagicCircleEffect(this.scene, 'left', initialTheme),
      right: new MagicCircleEffect(this.scene, 'right', initialTheme),
      dual: new MagicCircleEffect(this.scene, 'dual', initialTheme),
    }

    this.unsubscribeEvents = eventBus.subscribe(this.handleGestureEvent)
    this.configure(this.settings)

    const observedElement = canvas.parentElement ?? canvas
    const initialRect = observedElement.getBoundingClientRect()
    this.resize(initialRect.width || canvas.clientWidth || 1, initialRect.height || canvas.clientHeight || 1)
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver((entries) => {
        const entry = entries[0]
        if (entry) this.resize(entry.contentRect.width, entry.contentRect.height)
      })
      this.resizeObserver.observe(observedElement)
    }

    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', this.handleVisibilityChange)
  }

  /**
   * Normalized coordinates are expected to be display-oriented already. Set
   * mirrored=true only when feeding raw, unmirrored MediaPipe coordinates.
   */
  setCoordinateSpace(space: EffectCoordinateSpace, mirrored = false): void {
    if (this.disposed) return
    this.coordinateSpace = space
    this.mirrorNormalizedX = mirrored
  }

  /** Supplies source dimensions so normalized points match CSS object-fit. */
  setVideoSize(width: number, height: number, fit: VideoFitMode = 'cover'): void {
    if (this.disposed) return
    this.sourceWidth = Math.max(1, width)
    this.sourceHeight = Math.max(1, height)
    this.videoFit = fit
  }

  configure(settings: EffectRuntimeSettings): void {
    if (this.disposed) return
    this.settings = {
      ...settings,
      scale: clamp(settings.scale, 0.25, 2.5),
      brightness: clamp(settings.brightness, 0.15, 2.5),
      particleAmount: clamp(settings.particleAmount, 0, 1.5),
      particleSpeed: clamp(settings.particleSpeed, 0.2, 3),
    }

    const theme = EFFECT_THEMES[this.settings.theme]
    for (const circle of Object.values(this.circles)) {
      circle.setTheme(theme)
      circle.setEnabled(this.settings.enabled)
    }

    const preset = PERFORMANCE_PRESETS[this.settings.performanceMode]
    this.particles.setEnabled(this.settings.enabled && this.settings.particlesEnabled)
    this.particles.setLimit(preset.particleLimit)
    this.particles.setSpeedScale(this.settings.particleSpeed)
    this.pinchTrails.configure({
      enabled: this.settings.enabled,
      theme,
      performanceMode: this.settings.performanceMode,
      brightness: this.settings.brightness,
      effectScale: this.settings.scale,
    })
    this.shockwaves.configure({
      enabled: this.settings.enabled,
      theme,
      performanceMode: this.settings.performanceMode,
      brightness: this.settings.brightness,
    })
    this.resize(this.width, this.height)
  }

  resize(width: number, height: number): void {
    if (this.disposed) return
    const nextWidth = Math.max(1, Math.round(width))
    const nextHeight = Math.max(1, Math.round(height))
    const requestedPixelRatio = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1
    const dprLimit = PERFORMANCE_PRESETS[this.settings.performanceMode].dprLimit
    const nextPixelRatio = Math.min(requestedPixelRatio, dprLimit)
    if (nextWidth === this.width && nextHeight === this.height && nextPixelRatio === this.pixelRatio) return

    this.width = nextWidth
    this.height = nextHeight
    this.pixelRatio = nextPixelRatio
    this.renderer.setPixelRatio(nextPixelRatio)
    this.renderer.setSize(nextWidth, nextHeight, false)
    this.camera.left = -nextWidth / 2
    this.camera.right = nextWidth / 2
    this.camera.top = nextHeight / 2
    this.camera.bottom = -nextHeight / 2
    this.camera.updateProjectionMatrix()
    this.particles.setPixelRatio(nextPixelRatio)
    this.pinchTrails.resize(nextWidth, nextHeight, nextPixelRatio)
    this.shockwaves.resize(nextWidth, nextHeight)
  }

  start(): void {
    if (this.disposed || this.running) return
    this.running = true
    this.lastFrameTime = 0
    if (typeof document === 'undefined' || !document.hidden) this.renderer.setAnimationLoop(this.renderFrame)
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.running = false
    this.renderer.setAnimationLoop(null)
    this.unsubscribeEvents()
    this.resizeObserver?.disconnect()
    this.resizeObserver = null
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', this.handleVisibilityChange)

    this.circles.left.dispose()
    this.circles.right.dispose()
    this.circles.dual.dispose()
    this.pinchTrails.dispose()
    this.shockwaves.dispose()
    this.particles.dispose()
    this.scene.clear()
    this.renderer.dispose()
  }

  private readonly handleGestureEvent = (event: GestureEvent): void => {
    if (this.disposed || !this.settings.enabled) return
    const nowMs = performance.now()

    switch (event.type) {
      case 'PALM_OPEN': {
        if (this.dualActive) break
        this.circles[event.hand].activate(this.createHandTarget(event.pose), nowMs)
        break
      }
      case 'PALM_UPDATE': {
        if (this.dualActive) break
        this.circles[event.hand].updateTarget(this.createHandTarget(event.pose), nowMs)
        break
      }
      case 'PALM_CLOSE': {
        this.circles[event.hand].lose(nowMs)
        break
      }
      case 'HAND_LOST': {
        this.circles[event.hand].lose(nowMs)
        if (this.activePinches.delete(event.hand)) this.blockedPinches.add(event.hand)
        this.pinchTrails.end(event.hand, nowMs)
        break
      }
      case 'FIST': {
        if (this.dualActive) break
        const circle = this.circles[event.hand]
        circle.updateTarget(this.createHandTarget(event.pose), nowMs)
        circle.collapse(nowMs, event.intensity)
        if (this.activePinches.delete(event.hand)) this.blockedPinches.add(event.hand)
        this.pinchTrails.end(event.hand, nowMs)
        break
      }
      case 'TWO_HAND_CHARGE_START': {
        this.dualActive = true
        for (const hand of this.activePinches) this.blockedPinches.add(hand)
        this.activePinches.clear()
        this.pinchTrails.endAll(nowMs)
        this.circles.left.lose(nowMs)
        this.circles.right.lose(nowMs)
        const target = this.createDualTarget(event.center, event.distance)
        this.lastDualDiameter = target.diameter
        this.circles.dual.activate(target, nowMs)
        break
      }
      case 'TWO_HAND_CHARGE_UPDATE': {
        const target = this.createDualTarget(event.center, event.distance)
        this.lastDualDiameter = target.diameter
        this.circles.dual.updateTarget(target, nowMs)
        break
      }
      case 'TWO_HAND_CHARGE_END': {
        this.dualActive = false
        this.circles.dual.lose(nowMs)
        break
      }
      case 'TWO_HAND_RELEASE': {
        this.dualActive = false
        this.mapPoint(event.center)
        const releaseStrength = clamp(
          (Math.abs(event.velocity) - GESTURE_CONFIG.twoHand.releaseVelocity) /
            Math.max(0.01, 2.2 - GESTURE_CONFIG.twoHand.releaseVelocity),
          0,
          1,
        )
        this.shockwaves.trigger({
          x: this.mappedPoint.x,
          y: this.mappedPoint.y,
          nowMs,
          strength: releaseStrength,
          startRadius: this.lastDualDiameter * 0.42,
        })
        this.circles.dual.updateTarget(
          {
            x: this.mappedPoint.x,
            y: this.mappedPoint.y,
            diameter: this.lastDualDiameter,
            rotation: 0,
            normalZ: 1,
            confidence: 1,
          },
          nowMs,
        )
        this.circles.dual.collapse(nowMs, clamp(1 + Math.abs(event.velocity) * 1.4, 1, 2.4), true)
        break
      }
      case 'PINCH_START': {
        if (this.dualActive || this.blockedPinches.has(event.hand)) break
        this.activePinches.add(event.hand)
        this.mapPoint(event.position)
        this.pinchTrails.start(event.hand, this.mappedPoint.x, this.mappedPoint.y, nowMs)
        break
      }
      case 'PINCH_MOVE': {
        if (this.dualActive || !this.activePinches.has(event.hand) || this.blockedPinches.has(event.hand)) break
        this.mapPoint(event.position)
        this.pinchTrails.move(event.hand, this.mappedPoint.x, this.mappedPoint.y, nowMs)
        break
      }
      case 'PINCH_END':
        this.activePinches.delete(event.hand)
        this.blockedPinches.delete(event.hand)
        this.pinchTrails.end(event.hand, nowMs)
        break
    }
  }

  private readonly renderFrame = (timeMs: number): void => {
    if (!this.running || this.disposed) return
    const renderStartedAt = performance.now()
    const deltaSeconds = this.lastFrameTime === 0 ? 1 / 60 : clamp((timeMs - this.lastFrameTime) / 1000, 0, 0.05)
    this.lastFrameTime = timeMs

    this.circles.left.update(timeMs, deltaSeconds, this.settings, this.particles)
    this.circles.right.update(timeMs, deltaSeconds, this.settings, this.particles)
    this.circles.dual.update(timeMs, deltaSeconds, this.settings, this.particles)
    this.pinchTrails.update(timeMs, deltaSeconds)
    this.shockwaves.update(timeMs)
    this.particles.update(timeMs / 1000)
    this.renderer.render(this.scene, this.camera)

    if (this.onStats && timeMs - this.lastStatsTime >= 250) {
      this.lastStatsTime = timeMs
      this.onStats({
        renderMs: performance.now() - renderStartedAt,
        activeParticles: this.particles.activeCount,
        activeTrailSegments: this.pinchTrails.activeSegmentCount,
        activeShockwaves: this.shockwaves.activeCount,
        drawCalls: this.renderer.info.render.calls,
      })
    }
  }

  private readonly handleVisibilityChange = (): void => {
    if (!this.running || this.disposed) return
    if (document.hidden) {
      this.renderer.setAnimationLoop(null)
      this.lastFrameTime = 0
    } else {
      this.lastFrameTime = 0
      this.renderer.setAnimationLoop(this.renderFrame)
    }
  }

  private createHandTarget(pose: GesturePose): MagicCircleTarget {
    this.mapPoint(pose.position)
    const palmWidth = this.mapLength(pose.width)
    const maximumDiameter = Math.max(72, Math.min(this.width, this.height) * 0.62)
    return {
      x: this.mappedPoint.x,
      y: this.mappedPoint.y,
      diameter: clamp(palmWidth * 2.48 * this.settings.scale, 52, maximumDiameter),
      rotation: this.coordinateSpace === 'normalized' && this.mirrorNormalizedX ? -pose.rotation : pose.rotation,
      normalZ: Number.isFinite(pose.normal.z) ? pose.normal.z : 1,
      confidence: pose.confidence,
    }
  }

  private createDualTarget(center: Vector3Like, distance: number): MagicCircleTarget {
    this.mapPoint(center)
    const maximumDiameter = Math.max(150, Math.min(this.width, this.height) * 0.92)
    return {
      x: this.mappedPoint.x,
      y: this.mappedPoint.y,
      diameter: clamp(this.mapLength(distance) * 1.28 * this.settings.scale, 140, maximumDiameter),
      rotation: 0,
      normalZ: 1,
      confidence: 1,
    }
  }

  private mapPoint(point: Vector3Like): void {
    if (this.coordinateSpace === 'screen') {
      this.mappedPoint.x = point.x - this.width / 2
      this.mappedPoint.y = this.height / 2 - point.y
      return
    }

    const normalizedX = this.mirrorNormalizedX ? 1 - point.x : point.x
    if (this.videoFit === 'stretch' || this.sourceWidth <= 0 || this.sourceHeight <= 0) {
      this.mappedPoint.x = (normalizedX - 0.5) * this.width
      this.mappedPoint.y = (0.5 - point.y) * this.height
      return
    }

    const scaleX = this.width / this.sourceWidth
    const scaleY = this.height / this.sourceHeight
    const scale = this.videoFit === 'cover' ? Math.max(scaleX, scaleY) : Math.min(scaleX, scaleY)
    const contentWidth = this.sourceWidth * scale
    const contentHeight = this.sourceHeight * scale
    const screenX = (this.width - contentWidth) * 0.5 + normalizedX * contentWidth
    const screenY = (this.height - contentHeight) * 0.5 + point.y * contentHeight
    this.mappedPoint.x = screenX - this.width / 2
    this.mappedPoint.y = this.height / 2 - screenY
  }

  private mapLength(length: number): number {
    if (this.coordinateSpace === 'screen') return Math.abs(length)
    if (this.videoFit === 'stretch' || this.sourceWidth <= 0 || this.sourceHeight <= 0) {
      return Math.abs(length) * this.width
    }
    const scaleX = this.width / this.sourceWidth
    const scaleY = this.height / this.sourceHeight
    const scale = this.videoFit === 'cover' ? Math.max(scaleX, scaleY) : Math.min(scaleX, scaleY)
    return Math.abs(length) * this.sourceWidth * scale
  }
}
