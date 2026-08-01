import * as THREE from 'three'
import type { EffectTheme } from '../config/effectThemes'
import { PERFORMANCE_PRESETS } from '../config/performanceConfig'
import type { PerformanceMode } from '../types/settings'
import { clamp } from '../utils/math'
import { shockwaveFragmentShader, shockwaveVertexShader } from './shaders/shockwave'

export interface ShockwaveConfiguration {
  enabled?: boolean
  theme?: EffectTheme
  performanceMode?: PerformanceMode
  brightness?: number
}

export interface ShockwaveTriggerOptions {
  x: number
  y: number
  nowMs: number
  strength?: number
  startRadius?: number
  maxRadius?: number
}

interface ShockwavePerformanceProfile {
  limit: number
  lifetimeSeconds: number
}

const MAX_SHOCKWAVES = Math.max(
  PERFORMANCE_PRESETS.low.shockwaveLimit,
  PERFORMANCE_PRESETS.balanced.shockwaveLimit,
  PERFORMANCE_PRESETS.high.shockwaveLimit,
)
const MAIN_RING_LOCAL_RADIUS = 0.88

const LIFETIMES: Record<PerformanceMode, number> = {
  low: 0.58,
  balanced: 0.67,
  high: 0.76,
}

const getProfile = (mode: PerformanceMode): ShockwavePerformanceProfile => ({
  limit: PERFORMANCE_PRESETS[mode].shockwaveLimit,
  lifetimeSeconds: LIFETIMES[mode],
})

/** Fixed-slot, single-draw-call expanding energy waves. */
export class ShockwaveEffect {
  private readonly scene: THREE.Scene
  private readonly geometry: THREE.InstancedBufferGeometry
  private readonly material: THREE.ShaderMaterial
  private readonly mesh: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial>
  private readonly centers = new Float32Array(MAX_SHOCKWAVES * 2)
  private readonly births = new Float32Array(MAX_SHOCKWAVES)
  private readonly lifetimes = new Float32Array(MAX_SHOCKWAVES)
  private readonly startRadii = new Float32Array(MAX_SHOCKWAVES)
  private readonly maxRadii = new Float32Array(MAX_SHOCKWAVES)
  private readonly strengths = new Float32Array(MAX_SHOCKWAVES)
  private readonly seeds = new Float32Array(MAX_SHOCKWAVES)
  private readonly instanceAttributes: THREE.InstancedBufferAttribute[]

  private profile: ShockwavePerformanceProfile = getProfile('balanced')
  private mode: PerformanceMode = 'balanced'
  private enabled = true
  private width = 1
  private height = 1
  private cursor = 0
  private activeCountValue = 0
  private disposed = false

  constructor(scene: THREE.Scene, theme: EffectTheme) {
    this.scene = scene
    this.births.fill(-10000)
    this.lifetimes.fill(0.001)

    const basePositions = new Float32Array([
      -1, -1, 0,
      -1, 1, 0,
      1, -1, 0,
      1, 1, 0,
    ])
    const baseUvs = new Float32Array([
      0, 0,
      0, 1,
      1, 0,
      1, 1,
    ])
    const centerAttribute = new THREE.InstancedBufferAttribute(this.centers, 2).setUsage(THREE.DynamicDrawUsage)
    const birthAttribute = new THREE.InstancedBufferAttribute(this.births, 1).setUsage(THREE.DynamicDrawUsage)
    const lifetimeAttribute = new THREE.InstancedBufferAttribute(this.lifetimes, 1).setUsage(THREE.DynamicDrawUsage)
    const startRadiusAttribute = new THREE.InstancedBufferAttribute(this.startRadii, 1).setUsage(THREE.DynamicDrawUsage)
    const maxRadiusAttribute = new THREE.InstancedBufferAttribute(this.maxRadii, 1).setUsage(THREE.DynamicDrawUsage)
    const strengthAttribute = new THREE.InstancedBufferAttribute(this.strengths, 1).setUsage(THREE.DynamicDrawUsage)
    const seedAttribute = new THREE.InstancedBufferAttribute(this.seeds, 1).setUsage(THREE.DynamicDrawUsage)
    this.instanceAttributes = [
      centerAttribute,
      birthAttribute,
      lifetimeAttribute,
      startRadiusAttribute,
      maxRadiusAttribute,
      strengthAttribute,
      seedAttribute,
    ]

    this.geometry = new THREE.InstancedBufferGeometry()
    this.geometry.setAttribute('position', new THREE.BufferAttribute(basePositions, 3))
    this.geometry.setAttribute('uv', new THREE.BufferAttribute(baseUvs, 2))
    this.geometry.setIndex([0, 2, 1, 2, 3, 1])
    this.geometry.setAttribute('aCenter', centerAttribute)
    this.geometry.setAttribute('aBirthTime', birthAttribute)
    this.geometry.setAttribute('aLifetime', lifetimeAttribute)
    this.geometry.setAttribute('aStartRadius', startRadiusAttribute)
    this.geometry.setAttribute('aMaxRadius', maxRadiusAttribute)
    this.geometry.setAttribute('aStrength', strengthAttribute)
    this.geometry.setAttribute('aSeed', seedAttribute)
    this.geometry.instanceCount = this.profile.limit

    this.material = new THREE.ShaderMaterial({
      vertexShader: shockwaveVertexShader,
      fragmentShader: shockwaveFragmentShader,
      uniforms: {
        uTime: { value: 0 },
        uBrightness: { value: 1 },
        uPrimaryColor: { value: new THREE.Color(theme.primary) },
        uEdgeColor: { value: new THREE.Color(theme.edge) },
        uHighlightColor: { value: new THREE.Color(theme.highlight) },
      },
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    })
    this.mesh = new THREE.Mesh(this.geometry, this.material)
    this.mesh.frustumCulled = false
    this.mesh.renderOrder = 25
    this.mesh.visible = false
    this.scene.add(this.mesh)
  }

  get activeCount(): number {
    return this.activeCountValue
  }

  configure(configuration: ShockwaveConfiguration): void {
    if (this.disposed) return
    if (configuration.performanceMode && configuration.performanceMode !== this.mode) {
      this.mode = configuration.performanceMode
      this.profile = getProfile(this.mode)
      this.geometry.instanceCount = this.profile.limit
      this.cursor %= this.profile.limit
      for (let index = this.profile.limit; index < MAX_SHOCKWAVES; index += 1) this.births[index] = -10000
      this.instanceAttributes[1].needsUpdate = true
    }
    if (configuration.theme) this.setTheme(configuration.theme)
    if (configuration.brightness !== undefined) {
      this.material.uniforms.uBrightness.value = clamp(configuration.brightness, 0.15, 2.5)
    }
    if (configuration.enabled !== undefined && configuration.enabled !== this.enabled) {
      this.enabled = configuration.enabled
      if (!this.enabled) this.clear()
    }
  }

  setTheme(theme: EffectTheme): void {
    if (this.disposed) return
    this.material.uniforms.uPrimaryColor.value.setHex(theme.primary)
    this.material.uniforms.uEdgeColor.value.setHex(theme.edge)
    this.material.uniforms.uHighlightColor.value.setHex(theme.highlight)
  }

  resize(width: number, height: number): void {
    if (this.disposed) return
    this.width = Math.max(1, width)
    this.height = Math.max(1, height)
  }

  trigger(options: ShockwaveTriggerOptions): boolean {
    if (!this.enabled || this.disposed || !Number.isFinite(options.x) || !Number.isFinite(options.y)) return false
    const index = this.cursor
    const centerOffset = index * 2
    const strength = clamp(options.strength ?? 1, 0, 1)
    const visualStartRadius = Math.max(18, options.startRadius ?? 82)
    const farthestX = this.width * 0.5 + Math.abs(options.x)
    const farthestY = this.height * 0.5 + Math.abs(options.y)
    const requiredVisualRadius = Math.hypot(farthestX, farthestY) + 72
    const visualMaxRadius = Math.max(visualStartRadius + 80, options.maxRadius ?? requiredVisualRadius)

    this.centers[centerOffset] = options.x
    this.centers[centerOffset + 1] = options.y
    this.births[index] = options.nowMs / 1000
    this.lifetimes[index] = this.profile.lifetimeSeconds * (0.9 + strength * 0.2)
    // The shader's primary ring sits at 0.88 in local plane coordinates.
    this.startRadii[index] = visualStartRadius / MAIN_RING_LOCAL_RADIUS
    this.maxRadii[index] = visualMaxRadius / MAIN_RING_LOCAL_RADIUS
    this.strengths[index] = strength
    this.seeds[index] = Math.random() * 1000
    this.cursor = (index + 1) % this.profile.limit
    for (const attribute of this.instanceAttributes) attribute.needsUpdate = true
    this.mesh.visible = true
    return true
  }

  update(nowMs: number): void {
    if (this.disposed) return
    const nowSeconds = nowMs / 1000
    this.material.uniforms.uTime.value = nowSeconds
    this.activeCountValue = 0
    for (let index = 0; index < this.profile.limit; index += 1) {
      if (nowSeconds - this.births[index] < this.lifetimes[index]) this.activeCountValue += 1
    }
    this.mesh.visible = this.enabled && this.activeCountValue > 0
  }

  clear(): void {
    if (this.disposed) return
    this.births.fill(-10000)
    this.cursor = 0
    this.activeCountValue = 0
    this.instanceAttributes[1].needsUpdate = true
    this.mesh.visible = false
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.scene.remove(this.mesh)
    this.geometry.dispose()
    this.material.dispose()
  }
}
