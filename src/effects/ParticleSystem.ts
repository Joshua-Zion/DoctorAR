import * as THREE from 'three'

const particleVertexShader = /* glsl */ `
  precision highp float;

  uniform float uTime;
  uniform float uPixelRatio;
  uniform float uSpeedScale;
  uniform float uGravity;

  attribute vec3 aVelocity;
  attribute float aBirthTime;
  attribute float aLifetime;
  attribute float aSize;
  attribute vec3 aParticleColor;
  attribute float aSeed;

  varying vec3 vColor;
  varying float vAlpha;
  varying float vSeed;

  void main() {
    float age = max(0.0, uTime - aBirthTime);
    float lifeProgress = clamp(age / max(aLifetime, 0.001), 0.0, 1.0);
    vec3 animatedPosition = position + aVelocity * (age * uSpeedScale);
    animatedPosition.y += 0.5 * uGravity * age * age;

    vec4 viewPosition = modelViewMatrix * vec4(animatedPosition, 1.0);
    gl_Position = projectionMatrix * viewPosition;
    gl_PointSize = min(64.0, max(1.0, aSize * uPixelRatio * mix(1.0, 0.42, lifeProgress)));

    float fadeIn = smoothstep(0.0, 0.045, age);
    float fadeOut = 1.0 - smoothstep(0.62, 1.0, lifeProgress);
    vAlpha = fadeIn * fadeOut * step(lifeProgress, 0.9999);
    vColor = aParticleColor;
    vSeed = aSeed;
  }
`

const particleFragmentShader = /* glsl */ `
  precision highp float;

  uniform float uTime;

  varying vec3 vColor;
  varying float vAlpha;
  varying float vSeed;

  void main() {
    vec2 centered = gl_PointCoord * 2.0 - 1.0;
    float distanceFromCenter = length(centered);
    if (distanceFromCenter > 1.0) discard;

    float core = 1.0 - smoothstep(0.0, 0.22, distanceFromCenter);
    float glow = 1.0 - smoothstep(0.08, 1.0, distanceFromCenter);
    float flicker = 0.82 + 0.18 * sin(uTime * 23.0 + vSeed * 19.37);
    float alpha = (core + glow * 0.72) * vAlpha * flicker;

    gl_FragColor = vec4(vColor * (1.0 + core * 0.75), alpha);
  }
`

export interface ParticleBurstOptions {
  x: number
  y: number
  radius: number
  color: number
  intensity: number
  amount: number
  speed: number
  nowSeconds: number
}

export interface AmbientSparkOptions {
  x: number
  y: number
  radius: number
  color: number
  amount: number
  speed: number
  nowSeconds: number
}

/**
 * A single fixed-size GPU point cloud. Particle trajectories are evaluated in
 * the vertex shader; the CPU only allocates slots and reclaims expired ones.
 */
export class ParticleSystem {
  private readonly scene: THREE.Scene
  private readonly capacity: number
  private readonly geometry: THREE.BufferGeometry
  private readonly material: THREE.ShaderMaterial
  private readonly points: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>
  private readonly positions: Float32Array
  private readonly velocities: Float32Array
  private readonly birthTimes: Float32Array
  private readonly lifetimes: Float32Array
  private readonly sizes: Float32Array
  private readonly colors: Float32Array
  private readonly seeds: Float32Array
  private readonly dynamicAttributes: THREE.BufferAttribute[]
  private readonly colorScratch = new THREE.Color()

  private activeLimit: number
  private count = 0
  private enabled = true
  private attributesDirty = false
  private disposed = false

  constructor(scene: THREE.Scene, capacity: number) {
    this.scene = scene
    this.capacity = Math.max(1, Math.floor(capacity))
    this.activeLimit = this.capacity
    this.positions = new Float32Array(this.capacity * 3)
    this.velocities = new Float32Array(this.capacity * 3)
    this.birthTimes = new Float32Array(this.capacity)
    this.lifetimes = new Float32Array(this.capacity)
    this.sizes = new Float32Array(this.capacity)
    this.colors = new Float32Array(this.capacity * 3)
    this.seeds = new Float32Array(this.capacity)

    const positionAttribute = new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage)
    const velocityAttribute = new THREE.BufferAttribute(this.velocities, 3).setUsage(THREE.DynamicDrawUsage)
    const birthAttribute = new THREE.BufferAttribute(this.birthTimes, 1).setUsage(THREE.DynamicDrawUsage)
    const lifetimeAttribute = new THREE.BufferAttribute(this.lifetimes, 1).setUsage(THREE.DynamicDrawUsage)
    const sizeAttribute = new THREE.BufferAttribute(this.sizes, 1).setUsage(THREE.DynamicDrawUsage)
    const colorAttribute = new THREE.BufferAttribute(this.colors, 3).setUsage(THREE.DynamicDrawUsage)
    const seedAttribute = new THREE.BufferAttribute(this.seeds, 1).setUsage(THREE.DynamicDrawUsage)

    this.dynamicAttributes = [
      positionAttribute,
      velocityAttribute,
      birthAttribute,
      lifetimeAttribute,
      sizeAttribute,
      colorAttribute,
      seedAttribute,
    ]

    this.geometry = new THREE.BufferGeometry()
    this.geometry.setAttribute('position', positionAttribute)
    this.geometry.setAttribute('aVelocity', velocityAttribute)
    this.geometry.setAttribute('aBirthTime', birthAttribute)
    this.geometry.setAttribute('aLifetime', lifetimeAttribute)
    this.geometry.setAttribute('aSize', sizeAttribute)
    this.geometry.setAttribute('aParticleColor', colorAttribute)
    this.geometry.setAttribute('aSeed', seedAttribute)
    this.geometry.setDrawRange(0, 0)

    this.material = new THREE.ShaderMaterial({
      vertexShader: particleVertexShader,
      fragmentShader: particleFragmentShader,
      uniforms: {
        uTime: { value: 0 },
        uPixelRatio: { value: 1 },
        uSpeedScale: { value: 1 },
        uGravity: { value: -92 },
      },
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    })

    this.points = new THREE.Points(this.geometry, this.material)
    // Vertex shader displacement is invisible to CPU-side bounding-volume tests.
    this.points.frustumCulled = false
    this.points.renderOrder = 30
    this.scene.add(this.points)
  }

  get activeCount(): number {
    return this.count
  }

  setEnabled(enabled: boolean): void {
    if (this.disposed || this.enabled === enabled) return
    this.enabled = enabled
    this.points.visible = enabled
    if (!enabled) this.clear()
  }

  setLimit(limit: number): void {
    if (this.disposed) return
    this.activeLimit = Math.max(1, Math.min(this.capacity, Math.floor(limit)))
    if (this.count > this.activeLimit) {
      this.count = this.activeLimit
      this.geometry.setDrawRange(0, this.count)
    }
  }

  setPixelRatio(pixelRatio: number): void {
    if (this.disposed) return
    this.material.uniforms.uPixelRatio.value = Math.max(0.5, pixelRatio)
  }

  setSpeedScale(speedScale: number): void {
    if (this.disposed) return
    this.material.uniforms.uSpeedScale.value = Math.max(0.1, Math.min(3, speedScale))
  }

  emitAmbient(options: AmbientSparkOptions): void {
    if (!this.enabled || this.disposed || this.count >= Math.floor(this.activeLimit * 0.65)) return

    const angle = Math.random() * Math.PI * 2
    const radialJitter = options.radius * (0.78 + Math.random() * 0.24)
    const tangentX = -Math.sin(angle)
    const tangentY = Math.cos(angle)
    const outwardX = Math.cos(angle)
    const outwardY = Math.sin(angle)
    const baseSpeed = (22 + Math.random() * 54) * Math.max(0.2, options.speed)
    const amountScale = 0.65 + Math.max(0, options.amount) * 0.5

    this.spawn(
      options.x + outwardX * radialJitter,
      options.y + outwardY * radialJitter,
      tangentX * baseSpeed + outwardX * baseSpeed * 0.28,
      tangentY * baseSpeed + outwardY * baseSpeed * 0.28,
      0.42 + Math.random() * 0.52,
      (2 + Math.random() * 4.2) * amountScale,
      options.color,
      options.nowSeconds,
    )
  }

  emitBurst(options: ParticleBurstOptions): void {
    if (!this.enabled || this.disposed) return

    const normalizedAmount = Math.max(0, Math.min(1.5, options.amount))
    const normalizedIntensity = Math.max(0.25, Math.min(2.5, options.intensity))
    const requested = Math.max(10, Math.round((28 + normalizedAmount * 70) * normalizedIntensity))
    const burstCount = Math.min(requested, this.activeLimit)

    // Keep ambient emission from starving a high-priority burst.
    const maximumExisting = Math.max(0, this.activeLimit - burstCount)
    if (this.count > maximumExisting) this.count = maximumExisting

    for (let index = 0; index < burstCount; index += 1) {
      const angle = ((index + Math.random() * 0.72) / burstCount) * Math.PI * 2
      const directionX = Math.cos(angle)
      const directionY = Math.sin(angle)
      const originJitter = options.radius * Math.random() * 0.14
      const baseSpeed = (options.radius * (2.3 + Math.random() * 4.8) + 72) * Math.max(0.2, options.speed)
      const lateral = (Math.random() - 0.5) * baseSpeed * 0.22

      this.spawn(
        options.x + directionX * originJitter,
        options.y + directionY * originJitter,
        directionX * baseSpeed - directionY * lateral,
        directionY * baseSpeed + directionX * lateral,
        0.34 + Math.random() * 0.58,
        2.6 + Math.random() * 7.4,
        options.color,
        options.nowSeconds,
      )
    }
  }

  update(nowSeconds: number): void {
    if (this.disposed) return
    this.material.uniforms.uTime.value = nowSeconds

    let index = 0
    let removed = false
    while (index < this.count) {
      if (nowSeconds - this.birthTimes[index] >= this.lifetimes[index]) {
        this.removeAt(index)
        removed = true
      } else {
        index += 1
      }
    }

    if (removed) this.attributesDirty = true
    if (this.attributesDirty) {
      for (const attribute of this.dynamicAttributes) attribute.needsUpdate = true
      this.attributesDirty = false
    }
    this.geometry.setDrawRange(0, this.count)
  }

  clear(): void {
    if (this.disposed) return
    this.count = 0
    this.geometry.setDrawRange(0, 0)
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.scene.remove(this.points)
    this.geometry.dispose()
    this.material.dispose()
  }

  private spawn(
    x: number,
    y: number,
    velocityX: number,
    velocityY: number,
    lifetime: number,
    size: number,
    color: number,
    nowSeconds: number,
  ): boolean {
    if (this.count >= this.activeLimit) return false

    const index = this.count
    const vectorOffset = index * 3
    this.positions[vectorOffset] = x
    this.positions[vectorOffset + 1] = y
    this.positions[vectorOffset + 2] = 0
    this.velocities[vectorOffset] = velocityX
    this.velocities[vectorOffset + 1] = velocityY
    this.velocities[vectorOffset + 2] = 0
    this.birthTimes[index] = nowSeconds
    this.lifetimes[index] = lifetime
    this.sizes[index] = size
    this.seeds[index] = Math.random() * 1000

    this.colorScratch.setHex(color)
    const whiteMix = 0.08 + Math.random() * 0.42
    this.colors[vectorOffset] = this.colorScratch.r + (1 - this.colorScratch.r) * whiteMix
    this.colors[vectorOffset + 1] = this.colorScratch.g + (1 - this.colorScratch.g) * whiteMix
    this.colors[vectorOffset + 2] = this.colorScratch.b + (1 - this.colorScratch.b) * whiteMix

    this.count += 1
    this.attributesDirty = true
    return true
  }

  private removeAt(index: number): void {
    const lastIndex = this.count - 1
    if (index !== lastIndex) {
      const targetOffset = index * 3
      const sourceOffset = lastIndex * 3
      this.positions[targetOffset] = this.positions[sourceOffset]
      this.positions[targetOffset + 1] = this.positions[sourceOffset + 1]
      this.positions[targetOffset + 2] = this.positions[sourceOffset + 2]
      this.velocities[targetOffset] = this.velocities[sourceOffset]
      this.velocities[targetOffset + 1] = this.velocities[sourceOffset + 1]
      this.velocities[targetOffset + 2] = this.velocities[sourceOffset + 2]
      this.colors[targetOffset] = this.colors[sourceOffset]
      this.colors[targetOffset + 1] = this.colors[sourceOffset + 1]
      this.colors[targetOffset + 2] = this.colors[sourceOffset + 2]
      this.birthTimes[index] = this.birthTimes[lastIndex]
      this.lifetimes[index] = this.lifetimes[lastIndex]
      this.sizes[index] = this.sizes[lastIndex]
      this.seeds[index] = this.seeds[lastIndex]
    }
    this.count = lastIndex
  }
}
