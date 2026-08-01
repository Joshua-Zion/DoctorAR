import * as THREE from 'three'
import type { EffectTheme } from '../config/effectThemes'
import { PERFORMANCE_PRESETS } from '../config/performanceConfig'
import type { Handedness } from '../types/hand'
import type { PerformanceMode } from '../types/settings'
import { clamp, dampFactor } from '../utils/math'
import {
  pinchHeadFragmentShader,
  pinchHeadVertexShader,
  pinchTrailFragmentShader,
  pinchTrailVertexShader,
} from './shaders/pinchTrail'

export interface PinchTrailConfiguration {
  enabled?: boolean
  theme?: EffectTheme
  performanceMode?: PerformanceMode
  brightness?: number
  effectScale?: number
}

interface TrailPerformanceProfile {
  segmentLimit: number
  spacing: number
  lifetimeSeconds: number
  width: number
  pointSize: number
}

interface HandTrailState {
  active: boolean
  initialized: boolean
  targetX: number
  targetY: number
  currentX: number
  currentY: number
  lastSampleX: number
  lastSampleY: number
  lastMoveAt: number
  fadeStartedAt: number
  fadeStartOpacity: number
  opacity: number
}

const MAX_SEGMENTS = Math.max(
  PERFORMANCE_PRESETS.low.trailSegmentLimit,
  PERFORMANCE_PRESETS.balanced.trailSegmentLimit,
  PERFORMANCE_PRESETS.high.trailSegmentLimit,
)
const MAX_SEGMENTS_PER_MOVE = 16
const HEAD_FADE_MS = 240
const MOVE_TIMEOUT_MS = 220

const VISUAL_PROFILES: Record<PerformanceMode, Omit<TrailPerformanceProfile, 'segmentLimit' | 'spacing'>> = {
  low: { lifetimeSeconds: 0.72, width: 6, pointSize: 19 },
  balanced: { lifetimeSeconds: 0.9, width: 8.25, pointSize: 24 },
  high: { lifetimeSeconds: 1.04, width: 10, pointSize: 28 },
}

const getProfile = (mode: PerformanceMode): TrailPerformanceProfile => ({
  ...VISUAL_PROFILES[mode],
  segmentLimit: PERFORMANCE_PRESETS[mode].trailSegmentLimit,
  spacing: PERFORMANCE_PRESETS[mode].trailSpacingPx,
})

const HAND_INDEX: Record<Handedness, number> = { left: 0, right: 1 }

const createHandState = (): HandTrailState => ({
  active: false,
  initialized: false,
  targetX: 0,
  targetY: 0,
  currentX: 0,
  currentY: 0,
  lastSampleX: 0,
  lastSampleY: 0,
  lastMoveAt: 0,
  fadeStartedAt: 0,
  fadeStartOpacity: 0,
  opacity: 0,
})

/**
 * Fixed-capacity air-drawing effect. All trail segments share one instanced
 * draw call and both hand cores share one point-cloud draw call.
 */
export class PinchTrailEffect {
  private readonly scene: THREE.Scene
  private readonly trailGeometry: THREE.InstancedBufferGeometry
  private readonly trailMaterial: THREE.ShaderMaterial
  private readonly trailMesh: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial>
  private readonly headGeometry: THREE.BufferGeometry
  private readonly headMaterial: THREE.ShaderMaterial
  private readonly headPoints: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>
  private readonly segmentStarts = new Float32Array(MAX_SEGMENTS * 2)
  private readonly segmentEnds = new Float32Array(MAX_SEGMENTS * 2)
  private readonly segmentBirths = new Float32Array(MAX_SEGMENTS)
  private readonly segmentLifetimes = new Float32Array(MAX_SEGMENTS)
  private readonly segmentWidths = new Float32Array(MAX_SEGMENTS)
  private readonly segmentSeeds = new Float32Array(MAX_SEGMENTS)
  private readonly segmentAttributes: THREE.InstancedBufferAttribute[]
  private readonly headPositions = new Float32Array(6)
  private readonly headOpacities = new Float32Array(2)
  private readonly headPositionAttribute: THREE.BufferAttribute
  private readonly headOpacityAttribute: THREE.BufferAttribute
  private readonly hands: Record<Handedness, HandTrailState> = {
    left: createHandState(),
    right: createHandState(),
  }

  private profile: TrailPerformanceProfile = getProfile('balanced')
  private mode: PerformanceMode = 'balanced'
  private enabled = true
  private brightness = 1
  private effectScale = 1
  private viewportWidth = 1
  private viewportHeight = 1
  private segmentCursor = 0
  private activeSegmentsValue = 0
  private activeHeadsValue = 0
  private disposed = false

  constructor(scene: THREE.Scene, theme: EffectTheme) {
    this.scene = scene
    this.segmentBirths.fill(-10000)
    this.segmentLifetimes.fill(0.001)

    const basePositions = new Float32Array([
      0, -1, 0,
      0, 1, 0,
      1, -1, 0,
      1, 1, 0,
    ])
    const baseUvs = new Float32Array([
      0, 0,
      0, 1,
      1, 0,
      1, 1,
    ])
    const startAttribute = new THREE.InstancedBufferAttribute(this.segmentStarts, 2).setUsage(THREE.DynamicDrawUsage)
    const endAttribute = new THREE.InstancedBufferAttribute(this.segmentEnds, 2).setUsage(THREE.DynamicDrawUsage)
    const birthAttribute = new THREE.InstancedBufferAttribute(this.segmentBirths, 1).setUsage(THREE.DynamicDrawUsage)
    const lifetimeAttribute = new THREE.InstancedBufferAttribute(this.segmentLifetimes, 1).setUsage(THREE.DynamicDrawUsage)
    const widthAttribute = new THREE.InstancedBufferAttribute(this.segmentWidths, 1).setUsage(THREE.DynamicDrawUsage)
    const seedAttribute = new THREE.InstancedBufferAttribute(this.segmentSeeds, 1).setUsage(THREE.DynamicDrawUsage)
    this.segmentAttributes = [
      startAttribute,
      endAttribute,
      birthAttribute,
      lifetimeAttribute,
      widthAttribute,
      seedAttribute,
    ]

    this.trailGeometry = new THREE.InstancedBufferGeometry()
    this.trailGeometry.setAttribute('position', new THREE.BufferAttribute(basePositions, 3))
    this.trailGeometry.setAttribute('uv', new THREE.BufferAttribute(baseUvs, 2))
    this.trailGeometry.setIndex([0, 2, 1, 2, 3, 1])
    this.trailGeometry.setAttribute('aStart', startAttribute)
    this.trailGeometry.setAttribute('aEnd', endAttribute)
    this.trailGeometry.setAttribute('aBirthTime', birthAttribute)
    this.trailGeometry.setAttribute('aLifetime', lifetimeAttribute)
    this.trailGeometry.setAttribute('aWidth', widthAttribute)
    this.trailGeometry.setAttribute('aSeed', seedAttribute)
    this.trailGeometry.instanceCount = this.profile.segmentLimit

    this.trailMaterial = new THREE.ShaderMaterial({
      vertexShader: pinchTrailVertexShader,
      fragmentShader: pinchTrailFragmentShader,
      uniforms: {
        uTime: { value: 0 },
        uBrightness: { value: 1 },
        uPrimaryColor: { value: new THREE.Color(theme.primary) },
        uHighlightColor: { value: new THREE.Color(theme.highlight) },
      },
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    })
    this.trailMesh = new THREE.Mesh(this.trailGeometry, this.trailMaterial)
    this.trailMesh.frustumCulled = false
    this.trailMesh.renderOrder = 40
    this.trailMesh.visible = false
    this.scene.add(this.trailMesh)

    this.headPositionAttribute = new THREE.BufferAttribute(this.headPositions, 3).setUsage(THREE.DynamicDrawUsage)
    this.headOpacityAttribute = new THREE.BufferAttribute(this.headOpacities, 1).setUsage(THREE.DynamicDrawUsage)
    this.headGeometry = new THREE.BufferGeometry()
    this.headGeometry.setAttribute('position', this.headPositionAttribute)
    this.headGeometry.setAttribute('aOpacity', this.headOpacityAttribute)
    this.headGeometry.setAttribute('aSeed', new THREE.BufferAttribute(new Float32Array([0.31, 0.77]), 1))
    this.headGeometry.setDrawRange(0, 2)
    this.headMaterial = new THREE.ShaderMaterial({
      vertexShader: pinchHeadVertexShader,
      fragmentShader: pinchHeadFragmentShader,
      uniforms: {
        uTime: { value: 0 },
        uPixelRatio: { value: 1 },
        uPointSize: { value: this.profile.pointSize },
        uBrightness: { value: 1 },
        uPrimaryColor: { value: new THREE.Color(theme.primary) },
        uHighlightColor: { value: new THREE.Color(theme.highlight) },
      },
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    })
    this.headPoints = new THREE.Points(this.headGeometry, this.headMaterial)
    this.headPoints.frustumCulled = false
    this.headPoints.renderOrder = 41
    this.headPoints.visible = false
    this.scene.add(this.headPoints)
  }

  get activeSegmentCount(): number {
    return this.activeSegmentsValue
  }

  get activeHeadCount(): number {
    return this.activeHeadsValue
  }

  configure(configuration: PinchTrailConfiguration): void {
    if (this.disposed) return
    if (configuration.performanceMode && configuration.performanceMode !== this.mode) {
      this.mode = configuration.performanceMode
      this.profile = getProfile(this.mode)
      this.trailGeometry.instanceCount = this.profile.segmentLimit
      this.segmentCursor %= this.profile.segmentLimit
      for (let index = this.profile.segmentLimit; index < MAX_SEGMENTS; index += 1) {
        this.segmentBirths[index] = -10000
      }
      this.segmentAttributes[2].needsUpdate = true
    }
    if (configuration.theme) this.setTheme(configuration.theme)
    if (configuration.brightness !== undefined) this.brightness = clamp(configuration.brightness, 0.15, 2.5)
    if (configuration.effectScale !== undefined) this.effectScale = clamp(configuration.effectScale, 0.35, 2.5)
    if (configuration.enabled !== undefined && configuration.enabled !== this.enabled) {
      this.enabled = configuration.enabled
      if (!this.enabled) this.clear()
    }
    this.trailMaterial.uniforms.uBrightness.value = this.brightness
    this.headMaterial.uniforms.uBrightness.value = this.brightness
    this.headMaterial.uniforms.uPointSize.value = this.profile.pointSize * this.effectScale
  }

  setTheme(theme: EffectTheme): void {
    if (this.disposed) return
    this.trailMaterial.uniforms.uPrimaryColor.value.setHex(theme.primary)
    this.trailMaterial.uniforms.uHighlightColor.value.setHex(theme.highlight)
    this.headMaterial.uniforms.uPrimaryColor.value.setHex(theme.core)
    this.headMaterial.uniforms.uHighlightColor.value.setHex(theme.highlight)
  }

  resize(width: number, height: number, pixelRatio = 1): void {
    if (this.disposed) return
    this.viewportWidth = Math.max(1, width)
    this.viewportHeight = Math.max(1, height)
    this.headMaterial.uniforms.uPixelRatio.value = clamp(pixelRatio, 0.5, 3)
  }

  start(hand: Handedness, x: number, y: number, nowMs: number): void {
    if (!this.enabled || this.disposed || !Number.isFinite(x) || !Number.isFinite(y)) return
    const state = this.hands[hand]
    state.active = true
    state.initialized = true
    state.targetX = x
    state.targetY = y
    state.currentX = x
    state.currentY = y
    state.lastSampleX = x
    state.lastSampleY = y
    state.lastMoveAt = nowMs
    state.fadeStartedAt = 0
    state.opacity = Math.max(0.32, state.opacity)
  }

  move(hand: Handedness, x: number, y: number, nowMs: number): void {
    if (!this.enabled || this.disposed || !Number.isFinite(x) || !Number.isFinite(y)) return
    const state = this.hands[hand]
    if (!state.active || !state.initialized) {
      this.start(hand, x, y, nowMs)
      return
    }

    state.targetX = x
    state.targetY = y
    state.lastMoveAt = nowMs
    const jumpThreshold = Math.max(120, Math.hypot(this.viewportWidth, this.viewportHeight) * 0.18)
    let deltaX = x - state.lastSampleX
    let deltaY = y - state.lastSampleY
    let distance = Math.hypot(deltaX, deltaY)
    if (distance > jumpThreshold) {
      state.lastSampleX = x
      state.lastSampleY = y
      state.currentX = x
      state.currentY = y
      return
    }

    const spacing = this.profile.spacing * this.effectScale
    let inserted = 0
    while (distance >= spacing && inserted < MAX_SEGMENTS_PER_MOVE) {
      const ratio = spacing / distance
      const nextX = state.lastSampleX + deltaX * ratio
      const nextY = state.lastSampleY + deltaY * ratio
      this.addSegment(state.lastSampleX, state.lastSampleY, nextX, nextY, nowMs)
      state.lastSampleX = nextX
      state.lastSampleY = nextY
      deltaX = x - state.lastSampleX
      deltaY = y - state.lastSampleY
      distance = Math.hypot(deltaX, deltaY)
      inserted += 1
    }

    // Never retain a large backlog after a slow recognition frame.
    if (inserted >= MAX_SEGMENTS_PER_MOVE && distance >= spacing) {
      state.lastSampleX = x
      state.lastSampleY = y
    }
  }

  end(hand: Handedness, nowMs: number): void {
    if (this.disposed) return
    const state = this.hands[hand]
    if (!state.active) return
    state.active = false
    state.fadeStartedAt = nowMs
    state.fadeStartOpacity = state.opacity
  }

  endAll(nowMs: number): void {
    this.end('left', nowMs)
    this.end('right', nowMs)
  }

  update(nowMs: number, deltaSeconds: number): void {
    if (this.disposed) return
    const nowSeconds = nowMs / 1000
    this.trailMaterial.uniforms.uTime.value = nowSeconds
    this.headMaterial.uniforms.uTime.value = nowSeconds
    this.activeSegmentsValue = 0
    for (let index = 0; index < this.profile.segmentLimit; index += 1) {
      if (nowSeconds - this.segmentBirths[index] < this.segmentLifetimes[index]) this.activeSegmentsValue += 1
    }

    const damping = dampFactor(28, Math.min(0.05, Math.max(0, deltaSeconds)))
    this.activeHeadsValue = 0
    for (const hand of ['left', 'right'] as const) {
      const state = this.hands[hand]
      if (state.active && nowMs - state.lastMoveAt > MOVE_TIMEOUT_MS) this.end(hand, nowMs)
      state.currentX += (state.targetX - state.currentX) * damping
      state.currentY += (state.targetY - state.currentY) * damping
      if (state.active) {
        state.opacity += (1 - state.opacity) * dampFactor(22, deltaSeconds)
      } else if (state.fadeStartedAt > 0) {
        const fadeProgress = clamp((nowMs - state.fadeStartedAt) / HEAD_FADE_MS, 0, 1)
        state.opacity = state.fadeStartOpacity * (1 - fadeProgress * fadeProgress)
        if (fadeProgress >= 1) state.initialized = false
      } else {
        state.opacity = 0
      }

      const index = HAND_INDEX[hand]
      const offset = index * 3
      this.headPositions[offset] = state.currentX
      this.headPositions[offset + 1] = state.currentY
      this.headPositions[offset + 2] = 0
      this.headOpacities[index] = state.opacity
      if (state.opacity > 0.002) this.activeHeadsValue += 1
    }
    this.headPositionAttribute.needsUpdate = true
    this.headOpacityAttribute.needsUpdate = true
    this.trailMesh.visible = this.enabled && this.activeSegmentsValue > 0
    this.headPoints.visible = this.enabled && this.activeHeadsValue > 0
  }

  clear(): void {
    if (this.disposed) return
    this.segmentBirths.fill(-10000)
    this.segmentCursor = 0
    this.activeSegmentsValue = 0
    this.activeHeadsValue = 0
    for (const hand of ['left', 'right'] as const) {
      const state = this.hands[hand]
      state.active = false
      state.initialized = false
      state.opacity = 0
      state.fadeStartedAt = 0
    }
    this.headOpacities.fill(0)
    this.segmentAttributes[2].needsUpdate = true
    this.headOpacityAttribute.needsUpdate = true
    this.trailMesh.visible = false
    this.headPoints.visible = false
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.scene.remove(this.trailMesh)
    this.scene.remove(this.headPoints)
    this.trailGeometry.dispose()
    this.trailMaterial.dispose()
    this.headGeometry.dispose()
    this.headMaterial.dispose()
  }

  private addSegment(startX: number, startY: number, endX: number, endY: number, nowMs: number): void {
    const index = this.segmentCursor
    const offset = index * 2
    this.segmentStarts[offset] = startX
    this.segmentStarts[offset + 1] = startY
    this.segmentEnds[offset] = endX
    this.segmentEnds[offset + 1] = endY
    this.segmentBirths[index] = nowMs / 1000
    this.segmentLifetimes[index] = this.profile.lifetimeSeconds * (0.9 + Math.random() * 0.2)
    this.segmentWidths[index] = this.profile.width * this.effectScale * (0.9 + Math.random() * 0.2)
    this.segmentSeeds[index] = Math.random() * 1000
    this.segmentCursor = (index + 1) % this.profile.segmentLimit
    for (const attribute of this.segmentAttributes) attribute.needsUpdate = true
  }
}
