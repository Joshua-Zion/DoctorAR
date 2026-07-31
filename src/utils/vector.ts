import type { Vector2Like, Vector3Like } from '../types/hand'
import { clamp } from './math'

export const distance2 = (a: Vector2Like, b: Vector2Like): number => Math.hypot(a.x - b.x, a.y - b.y)

export const distance3 = (a: Vector3Like, b: Vector3Like): number => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)

export const subtract3 = (a: Vector3Like, b: Vector3Like): Vector3Like => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z })

export const dot3 = (a: Vector3Like, b: Vector3Like): number => a.x * b.x + a.y * b.y + a.z * b.z

export const cross3 = (a: Vector3Like, b: Vector3Like): Vector3Like => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
})

export const normalize3 = (value: Vector3Like): Vector3Like => {
  const length = Math.hypot(value.x, value.y, value.z)
  if (length < 1e-8) return { x: 0, y: 0, z: 1 }
  return { x: value.x / length, y: value.y / length, z: value.z / length }
}

export const angleAt = (a: Vector3Like, pivot: Vector3Like, c: Vector3Like): number => {
  const pa = normalize3(subtract3(a, pivot))
  const pc = normalize3(subtract3(c, pivot))
  return Math.acos(clamp(dot3(pa, pc), -1, 1))
}

export const midpoint3 = (a: Vector3Like, b: Vector3Like): Vector3Like => ({
  x: (a.x + b.x) * 0.5,
  y: (a.y + b.y) * 0.5,
  z: (a.z + b.z) * 0.5,
})
