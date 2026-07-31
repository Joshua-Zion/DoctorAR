import type { HandLandmark, Vector3Like } from '../types/hand'

export const HAND_LANDMARK = {
  WRIST: 0,
  THUMB_CMC: 1,
  THUMB_MCP: 2,
  THUMB_IP: 3,
  THUMB_TIP: 4,
  INDEX_MCP: 5,
  INDEX_PIP: 6,
  INDEX_DIP: 7,
  INDEX_TIP: 8,
  MIDDLE_MCP: 9,
  MIDDLE_PIP: 10,
  MIDDLE_DIP: 11,
  MIDDLE_TIP: 12,
  RING_MCP: 13,
  RING_PIP: 14,
  RING_DIP: 15,
  RING_TIP: 16,
  PINKY_MCP: 17,
  PINKY_PIP: 18,
  PINKY_DIP: 19,
  PINKY_TIP: 20,
} as const

export const PALM_LANDMARKS = [
  HAND_LANDMARK.WRIST,
  HAND_LANDMARK.INDEX_MCP,
  HAND_LANDMARK.MIDDLE_MCP,
  HAND_LANDMARK.RING_MCP,
  HAND_LANDMARK.PINKY_MCP,
] as const

export const KNUCKLE_LANDMARKS = [
  HAND_LANDMARK.INDEX_MCP,
  HAND_LANDMARK.MIDDLE_MCP,
  HAND_LANDMARK.RING_MCP,
  HAND_LANDMARK.PINKY_MCP,
] as const

export const FINGER_CHAINS = {
  thumb: [HAND_LANDMARK.THUMB_CMC, HAND_LANDMARK.THUMB_MCP, HAND_LANDMARK.THUMB_IP, HAND_LANDMARK.THUMB_TIP],
  index: [HAND_LANDMARK.INDEX_MCP, HAND_LANDMARK.INDEX_PIP, HAND_LANDMARK.INDEX_DIP, HAND_LANDMARK.INDEX_TIP],
  middle: [HAND_LANDMARK.MIDDLE_MCP, HAND_LANDMARK.MIDDLE_PIP, HAND_LANDMARK.MIDDLE_DIP, HAND_LANDMARK.MIDDLE_TIP],
  ring: [HAND_LANDMARK.RING_MCP, HAND_LANDMARK.RING_PIP, HAND_LANDMARK.RING_DIP, HAND_LANDMARK.RING_TIP],
  pinky: [HAND_LANDMARK.PINKY_MCP, HAND_LANDMARK.PINKY_PIP, HAND_LANDMARK.PINKY_DIP, HAND_LANDMARK.PINKY_TIP],
} as const

export const isValidHandLandmarks = (landmarks: readonly HandLandmark[]): boolean =>
  landmarks.length === 21 && landmarks.every((landmark) => Number.isFinite(landmark.x) && Number.isFinite(landmark.y) && Number.isFinite(landmark.z))

export const averageLandmarks = (landmarks: readonly HandLandmark[], indices: readonly number[]): Vector3Like => {
  if (indices.length === 0) return { x: 0, y: 0, z: 0 }

  const total = indices.reduce(
    (sum, index) => {
      const landmark = landmarks[index]
      return { x: sum.x + landmark.x, y: sum.y + landmark.y, z: sum.z + landmark.z }
    },
    { x: 0, y: 0, z: 0 },
  )

  const scale = 1 / indices.length
  return { x: total.x * scale, y: total.y * scale, z: total.z * scale }
}

export const getPalmCenter = (landmarks: readonly HandLandmark[]): Vector3Like => averageLandmarks(landmarks, PALM_LANDMARKS)

export const getKnuckleCenter = (landmarks: readonly HandLandmark[]): Vector3Like => averageLandmarks(landmarks, KNUCKLE_LANDMARKS)
