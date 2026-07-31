import type { HandLandmark, Vector2Like, Vector3Like } from '../types/hand'

export interface CoordinateMapperOptions {
  mirrored?: boolean
  videoWidth?: number
  videoHeight?: number
}

const copyVisibility = (landmark: HandLandmark): Pick<HandLandmark, 'visibility'> =>
  Number.isFinite(landmark.visibility) ? { visibility: landmark.visibility } : {}

export class CoordinateMapper {
  private mirroredValue: boolean
  private widthValue: number
  private heightValue: number

  constructor(options: CoordinateMapperOptions = {}) {
    this.mirroredValue = options.mirrored ?? true
    this.widthValue = Math.max(1, options.videoWidth ?? 1)
    this.heightValue = Math.max(1, options.videoHeight ?? 1)
  }

  get mirrored(): boolean {
    return this.mirroredValue
  }

  get videoWidth(): number {
    return this.widthValue
  }

  get videoHeight(): number {
    return this.heightValue
  }

  setVideoSize(width: number, height: number): void {
    this.widthValue = Math.max(1, width)
    this.heightValue = Math.max(1, height)
  }

  setMirrored(mirrored: boolean): void {
    this.mirroredValue = mirrored
  }

  mapNormalized(landmark: HandLandmark): HandLandmark {
    return {
      x: this.mirroredValue ? 1 - landmark.x : landmark.x,
      y: landmark.y,
      z: landmark.z,
      ...copyVisibility(landmark),
    }
  }

  mapNormalizedList(landmarks: readonly HandLandmark[]): HandLandmark[] {
    return landmarks.map((landmark) => this.mapNormalized(landmark))
  }

  mapWorld(landmark: HandLandmark): HandLandmark {
    return {
      x: this.mirroredValue ? -landmark.x : landmark.x,
      y: landmark.y,
      z: landmark.z,
      ...copyVisibility(landmark),
    }
  }

  mapWorldList(landmarks: readonly HandLandmark[]): HandLandmark[] {
    return landmarks.map((landmark) => this.mapWorld(landmark))
  }

  /** Returns a vector in image-width units, so x/y remain comparable on non-square video. */
  aspectVector(from: Vector2Like, to: Vector2Like): Vector2Like {
    return {
      x: to.x - from.x,
      y: (to.y - from.y) * (this.heightValue / this.widthValue),
    }
  }

  distance(from: Vector2Like, to: Vector2Like): number {
    const delta = this.aspectVector(from, to)
    return Math.hypot(delta.x, delta.y)
  }

  speed(velocity: Vector2Like): number {
    return Math.hypot(velocity.x, velocity.y * (this.heightValue / this.widthValue))
  }

  /** Maps an already-standardized normalized point into an object-fit: cover display surface. */
  mapToDisplay(point: Vector2Like, stageWidth: number, stageHeight: number): Vector2Like {
    const safeStageWidth = Math.max(1, stageWidth)
    const safeStageHeight = Math.max(1, stageHeight)
    const coverScale = Math.max(safeStageWidth / this.widthValue, safeStageHeight / this.heightValue)
    const renderedWidth = this.widthValue * coverScale
    const renderedHeight = this.heightValue * coverScale
    const offsetX = (safeStageWidth - renderedWidth) * 0.5
    const offsetY = (safeStageHeight - renderedHeight) * 0.5
    return {
      x: offsetX + point.x * renderedWidth,
      y: offsetY + point.y * renderedHeight,
    }
  }

  toAspectCorrected3(landmark: Vector3Like): Vector3Like {
    const aspect = this.widthValue / this.heightValue
    return { x: landmark.x * aspect, y: landmark.y, z: landmark.z * aspect }
  }
}
