import type { Level, V3 } from '../core/types'
import { TOPICS, TRACKS, type TopicEntry, type TrackId } from '../topics/registry'

// Where each district and building stands on the home map.
//
// On screen, +x runs up-right and +z down-right, so the four tracks read like
// a page: Scaling (top-left) → Data (top-right) → Async (bottom-left) →
// Distributed (bottom-right), with the capstones downtown in the middle.

export const DISTRICT_HALF = 2.2

export const DISTRICTS: Record<TrackId, { x: number; z: number }> = {
  scaling: { x: 0, z: -5 },
  data: { x: 5, z: 0 },
  async: { x: -5, z: 0 },
  distributed: { x: 0, z: 5 },
  capstones: { x: 0, z: 0 },
}

// Streets run in the gaps between districts.
export const STREETS: V3[][] = [-2.5, 2.5].flatMap((v): V3[][] => [
  [
    [-7.5, 0, v],
    [7.5, 0, v],
  ],
  [
    [v, 0, -7.5],
    [v, 0, 7.5],
  ],
])

const HEIGHT: Record<Level, number> = { Beginner: 1.1, Intermediate: 1.5, Advanced: 1.9 }

// Four topics per district, in reading order on screen: left, top, bottom, right.
const DISTRICT_SPOTS: [number, number][] = [
  [-1.1, -1.1],
  [1.1, -1.1],
  [-1.1, 1.1],
  [1.1, 1.1],
]

// Five capstones downtown: the four corners plus a taller tower in the middle.
const DOWNTOWN_SPOTS: [number, number][] = [
  [-1.35, -1.35],
  [1.35, -1.35],
  [0, 0],
  [-1.35, 1.35],
  [1.35, 1.35],
]

export interface Lot {
  topic: TopicEntry
  x: number
  z: number
  size: number // footprint, square
  h: number
}

export const LOTS: Lot[] = TRACKS.flatMap((track) => {
  const district = DISTRICTS[track.id]
  const downtown = track.id === 'capstones'
  const spots = downtown ? DOWNTOWN_SPOTS : DISTRICT_SPOTS
  return TOPICS.filter((t) => t.track === track.id).map((topic, i): Lot => {
    const [dx, dz] = spots[i]
    return {
      topic,
      x: district.x + dx,
      z: district.z + dz,
      size: downtown ? 0.95 : 1.15,
      h: downtown ? (dx === 0 && dz === 0 ? 2.8 : 2.3) : HEIGHT[track.level],
    }
  })
})
