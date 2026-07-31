export const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value))

export const saturate = (value: number): number => clamp(value, 0, 1)

export const lerp = (from: number, to: number, amount: number): number => from + (to - from) * amount

export const inverseLerp = (from: number, to: number, value: number): number => from === to ? 0 : saturate((value - from) / (to - from))

export const remap = (value: number, sourceMin: number, sourceMax: number, targetMin: number, targetMax: number): number =>
  lerp(targetMin, targetMax, inverseLerp(sourceMin, sourceMax, value))

export const dampFactor = (lambda: number, deltaSeconds: number): number => 1 - Math.exp(-lambda * deltaSeconds)

export const angleDelta = (from: number, to: number): number => Math.atan2(Math.sin(to - from), Math.cos(to - from))

export const dampAngle = (from: number, to: number, lambda: number, deltaSeconds: number): number =>
  from + angleDelta(from, to) * dampFactor(lambda, deltaSeconds)
