import * as THREE from 'three'
import type { EffectTheme } from '../config/effectThemes'
import type { EffectRuntimeSettings } from '../types/effect'
import { clamp, dampAngle, dampFactor } from '../utils/math'
import { ParticleSystem } from './ParticleSystem'
import { magicCircleFragmentShader, magicCircleVertexShader } from './shaders/magicCircle'

export type MagicCircleKind = 'left' | 'right' | 'dual'

export interface MagicCircleTarget {
  x: number
  y: number
  diameter: number
  rotation: number
  normalZ: number
  confidence: number
}

type MagicCirclePhase = 'hidden' | 'entering' | 'tracking' | 'lost' | 'collapsing'

const ENTER_DURATION_MS = 165
const LOST_HOLD_MS = 145
const LOST_FADE_MS = 290
const COLLAPSE_DURATION_MS = 170
const STALE_TARGET_MS = 240

const createMaterial = (layer: number, theme: EffectTheme): THREE.ShaderMaterial =>
  new THREE.ShaderMaterial({
    vertexShader: magicCircleVertexShader,
    fragmentShader: magicCircleFragmentShader,
    uniforms: {
      uTime: { value: 0 },
      uPhase: { value: 0 },
      uLayer: { value: layer },
      uOpacity: { value: 0 },
      uBrightness: { value: 1 },
      uGlowStrength: { value: theme.glowStrength },
      uPrimaryColor: { value: new THREE.Color(theme.primary) },
      uEdgeColor: { value: new THREE.Color(theme.edge) },
      uHighlightColor: { value: new THREE.Color(theme.highlight) },
      uCoreColor: { value: new THREE.Color(theme.core) },
    },
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  })

/** A fixed scene slot for one hand or the two-hand charge effect. */
export class MagicCircleEffect {
  private readonly scene: THREE.Scene
  private readonly kind: MagicCircleKind
  private readonly root = new THREE.Group()
  private readonly sizeNode = new THREE.Group()
  private readonly geometry = new THREE.PlaneGeometry(1, 1)
  private readonly outerMaterial: THREE.ShaderMaterial
  private readonly innerMaterial: THREE.ShaderMaterial
  private readonly coreMaterial: THREE.ShaderMaterial
  private readonly materials: THREE.ShaderMaterial[]
  private readonly outerMesh: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>
  private readonly innerMesh: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>
  private readonly coreMesh: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>

  private phase: MagicCirclePhase = 'hidden'
  private enabled = true
  private disposed = false
  private theme: EffectTheme
  private targetX = 0
  private targetY = 0
  private targetDiameter = 100
  private targetRotation = 0
  private targetSquash = 1
  private targetConfidence = 1
  private currentX = 0
  private currentY = 0
  private currentDiameter = 100
  private currentRotation = 0
  private currentSquash = 1
  private opacity = 0
  private lifecycleScale = 0.08
  private phaseStartedAt = 0
  private lastSeenAt = 0
  private lostStartOpacity = 0
  private collapseStartOpacity = 0
  private collapseStartScale = 1
  private collapseIntensity = 1
  private burstEmitted = false
  private ambientBudget = 0

  constructor(scene: THREE.Scene, kind: MagicCircleKind, theme: EffectTheme) {
    this.scene = scene
    this.kind = kind
    this.theme = theme
    this.outerMaterial = createMaterial(0, theme)
    this.innerMaterial = createMaterial(1, theme)
    this.coreMaterial = createMaterial(2, theme)
    this.materials = [this.outerMaterial, this.innerMaterial, this.coreMaterial]

    this.outerMesh = new THREE.Mesh(this.geometry, this.outerMaterial)
    this.innerMesh = new THREE.Mesh(this.geometry, this.innerMaterial)
    this.coreMesh = new THREE.Mesh(this.geometry, this.coreMaterial)
    this.outerMesh.renderOrder = 10
    this.innerMesh.renderOrder = 11
    this.coreMesh.renderOrder = 12
    this.outerMesh.frustumCulled = false
    this.innerMesh.frustumCulled = false
    this.coreMesh.frustumCulled = false

    this.sizeNode.add(this.outerMesh, this.innerMesh, this.coreMesh)
    this.root.add(this.sizeNode)
    this.root.visible = false
    this.root.position.z = kind === 'dual' ? 0 : 2
    this.scene.add(this.root)
  }

  get isVisible(): boolean {
    return this.root.visible
  }

  get currentPhase(): MagicCirclePhase {
    return this.phase
  }

  setEnabled(enabled: boolean): void {
    if (this.disposed || this.enabled === enabled) return
    this.enabled = enabled
    if (!enabled) this.hide()
  }

  setTheme(theme: EffectTheme): void {
    if (this.disposed) return
    this.theme = theme
    for (const material of this.materials) {
      material.uniforms.uPrimaryColor.value.setHex(theme.primary)
      material.uniforms.uEdgeColor.value.setHex(theme.edge)
      material.uniforms.uHighlightColor.value.setHex(theme.highlight)
      material.uniforms.uCoreColor.value.setHex(theme.core)
      material.uniforms.uGlowStrength.value = theme.glowStrength
    }
  }

  activate(target: MagicCircleTarget, nowMs: number): void {
    if (!this.enabled || this.disposed || this.phase === 'collapsing') return
    this.copyTarget(target, nowMs)

    if (this.phase === 'hidden') {
      this.currentX = target.x
      this.currentY = target.y
      this.currentDiameter = target.diameter
      this.currentRotation = target.rotation
      this.currentSquash = clamp(Math.abs(target.normalZ), 0.58, 1)
      this.opacity = 0
      this.lifecycleScale = 0.08
      this.phase = 'entering'
      this.phaseStartedAt = nowMs
      this.root.visible = true
      return
    }

    if (this.phase === 'lost') {
      this.phase = 'tracking'
      this.phaseStartedAt = nowMs
    }
  }

  updateTarget(target: MagicCircleTarget, nowMs: number): void {
    if (!this.enabled || this.disposed || this.phase === 'collapsing') return
    if (this.phase === 'hidden') {
      this.activate(target, nowMs)
      return
    }
    this.copyTarget(target, nowMs)
    if (this.phase === 'lost') this.phase = 'tracking'
  }

  lose(nowMs: number): void {
    if (this.disposed || this.phase === 'hidden' || this.phase === 'lost' || this.phase === 'collapsing') return
    this.phase = 'lost'
    this.phaseStartedAt = nowMs
    this.lostStartOpacity = this.opacity
  }

  collapse(nowMs: number, intensity = 1): void {
    if (this.disposed || this.phase === 'hidden' || this.phase === 'collapsing') return
    this.phase = 'collapsing'
    this.phaseStartedAt = nowMs
    this.collapseStartOpacity = Math.max(0.35, this.opacity)
    this.collapseStartScale = Math.max(0.25, this.lifecycleScale)
    this.collapseIntensity = clamp(intensity, 0.25, 2.5)
    this.burstEmitted = false
  }

  update(
    nowMs: number,
    deltaSeconds: number,
    settings: EffectRuntimeSettings,
    particles: ParticleSystem,
  ): void {
    if (this.disposed || !this.enabled || this.phase === 'hidden') return

    if ((this.phase === 'tracking' || this.phase === 'entering') && nowMs - this.lastSeenAt > STALE_TARGET_MS) {
      this.lose(nowMs)
    }

    const positionDamping = dampFactor(18, deltaSeconds)
    const sizeDamping = dampFactor(12, deltaSeconds)
    const squashDamping = dampFactor(9, deltaSeconds)
    this.currentX += (this.targetX - this.currentX) * positionDamping
    this.currentY += (this.targetY - this.currentY) * positionDamping
    this.currentDiameter += (this.targetDiameter - this.currentDiameter) * sizeDamping
    this.currentRotation = dampAngle(this.currentRotation, this.targetRotation, 10, deltaSeconds)
    this.currentSquash += (this.targetSquash - this.currentSquash) * squashDamping

    if (this.phase === 'entering') {
      const progress = clamp((nowMs - this.phaseStartedAt) / ENTER_DURATION_MS, 0, 1)
      const eased = 1 - Math.pow(1 - progress, 3)
      this.lifecycleScale = eased + Math.sin(progress * Math.PI) * 0.075
      this.opacity = progress * clamp(0.62 + this.targetConfidence * 0.48, 0.65, 1)
      if (progress >= 1) this.phase = 'tracking'
    } else if (this.phase === 'tracking') {
      const opacityTarget = clamp(0.64 + this.targetConfidence * 0.44, 0.68, 1)
      this.opacity += (opacityTarget - this.opacity) * dampFactor(12, deltaSeconds)
      this.lifecycleScale += (1 - this.lifecycleScale) * dampFactor(14, deltaSeconds)
    } else if (this.phase === 'lost') {
      const elapsed = nowMs - this.phaseStartedAt
      if (elapsed > LOST_HOLD_MS) {
        const fadeProgress = clamp((elapsed - LOST_HOLD_MS) / LOST_FADE_MS, 0, 1)
        const easedFade = fadeProgress * fadeProgress * (3 - 2 * fadeProgress)
        this.opacity = this.lostStartOpacity * (1 - easedFade)
        this.lifecycleScale = 1 - easedFade * 0.16
        if (fadeProgress >= 1) {
          this.hide()
          return
        }
      }
    } else if (this.phase === 'collapsing') {
      const progress = clamp((nowMs - this.phaseStartedAt) / COLLAPSE_DURATION_MS, 0, 1)
      const contraction = progress * progress
      this.lifecycleScale = this.collapseStartScale * (1 - contraction * 0.91)
      this.opacity = this.collapseStartOpacity * (1 - Math.pow(progress, 1.45))

      if (!this.burstEmitted && progress >= 0.42) {
        this.burstEmitted = true
        if (settings.particlesEnabled) {
          particles.emitBurst({
            x: this.currentX,
            y: this.currentY,
            radius: this.currentDiameter * 0.44,
            color: this.theme.particle,
            intensity: this.collapseIntensity * (this.kind === 'dual' ? 1.35 : 1),
            amount: settings.particleAmount,
            speed: 1,
            nowSeconds: nowMs / 1000,
          })
        }
      }

      if (progress >= 1) {
        this.hide()
        return
      }
    }

    this.applyTransformAndUniforms(nowMs, settings)
    if (this.phase === 'tracking' || this.phase === 'entering') {
      this.emitAmbientParticles(nowMs, deltaSeconds, settings, particles)
    }
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.scene.remove(this.root)
    this.geometry.dispose()
    for (const material of this.materials) material.dispose()
    this.root.clear()
  }

  private copyTarget(target: MagicCircleTarget, nowMs: number): void {
    this.targetX = target.x
    this.targetY = target.y
    this.targetDiameter = Math.max(24, target.diameter)
    this.targetRotation = target.rotation
    this.targetSquash = clamp(Math.abs(target.normalZ), 0.58, 1)
    this.targetConfidence = clamp(target.confidence, 0, 1)
    this.lastSeenAt = nowMs
  }

  private applyTransformAndUniforms(nowMs: number, settings: EffectRuntimeSettings): void {
    const timeSeconds = nowMs / 1000
    const spinMultiplier = this.kind === 'dual' ? 0.72 : 1
    const visualDiameter = Math.max(1, this.currentDiameter * this.lifecycleScale)
    this.root.position.x = this.currentX
    this.root.position.y = this.currentY
    this.root.rotation.z = this.currentRotation
    this.sizeNode.scale.set(visualDiameter, visualDiameter * this.currentSquash, 1)
    this.outerMesh.rotation.z = timeSeconds * 0.19 * spinMultiplier
    this.innerMesh.rotation.z = -timeSeconds * 0.31 * spinMultiplier
    this.coreMesh.rotation.z = timeSeconds * 0.11 * spinMultiplier

    const brightness = clamp(settings.brightness, 0.15, 2.5)
    for (let layer = 0; layer < this.materials.length; layer += 1) {
      const material = this.materials[layer]
      const direction = layer === 1 ? -1 : 1
      material.uniforms.uTime.value = timeSeconds
      material.uniforms.uPhase.value = timeSeconds * (0.23 + layer * 0.08) * direction * spinMultiplier
      material.uniforms.uOpacity.value = clamp(this.opacity, 0, 1)
      material.uniforms.uBrightness.value = brightness
    }
  }

  private emitAmbientParticles(
    nowMs: number,
    deltaSeconds: number,
    settings: EffectRuntimeSettings,
    particles: ParticleSystem,
  ): void {
    if (!settings.particlesEnabled || this.opacity < 0.22) return

    const baseRate = this.kind === 'dual' ? 17 : 10
    const rate = baseRate * clamp(0.35 + settings.particleAmount, 0.2, 1.8)
    this.ambientBudget = Math.min(3, this.ambientBudget + rate * deltaSeconds)
    let emittedThisFrame = 0
    while (this.ambientBudget >= 1 && emittedThisFrame < 3) {
      particles.emitAmbient({
        x: this.currentX,
        y: this.currentY,
        radius: this.currentDiameter * this.lifecycleScale * 0.46,
        color: this.theme.particle,
        amount: settings.particleAmount,
        speed: 1,
        nowSeconds: nowMs / 1000,
      })
      this.ambientBudget -= 1
      emittedThisFrame += 1
    }
  }

  private hide(): void {
    this.phase = 'hidden'
    this.root.visible = false
    this.opacity = 0
    this.lifecycleScale = 0.08
    this.ambientBudget = 0
    for (const material of this.materials) material.uniforms.uOpacity.value = 0
  }
}
