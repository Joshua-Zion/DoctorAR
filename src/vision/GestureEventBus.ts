import type { GestureEvent } from '../types/gesture'

export type GestureEventListener = (event: GestureEvent) => void

export class GestureEventBus {
  private readonly listeners = new Set<GestureEventListener>()

  subscribe(listener: GestureEventListener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  emit(event: GestureEvent): void {
    for (const listener of [...this.listeners]) {
      try {
        listener(event)
      } catch (error) {
        console.error('Gesture event listener failed', error)
      }
    }
  }

  clear(): void {
    this.listeners.clear()
  }
}
