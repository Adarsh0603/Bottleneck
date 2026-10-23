// The CDN world: one origin server and users in three regions, at very
// different distances from it. Travel time grows with distance on the floor.

import type { V3 } from '../../core/types'

export type RegionId = 'us' | 'eu' | 'asia'

export const ORIGIN = { x: 5, z: -0.5 }

export const REGIONS: { id: RegionId; name: string; x: number; z: number }[] = [
  { id: 'us', name: 'US', x: 2, z: 3.2 },
  { id: 'eu', name: 'Europe', x: -1.6, z: -3.8 },
  { id: 'asia', name: 'Asia', x: -6.8, z: 1.4 },
]

// Slower than this, and a region's label turns red.
export const SLOW_MS = 750

export const TICKS_PER_SECOND = 20
export const MS_PER_TICK = 1000 / TICKS_PER_SECOND
const TICKS_PER_UNIT = 2

// Where a region's edge server stands: a short hop from its users, toward
// the origin.
export function edgeSpot(id: RegionId) {
  const r = REGIONS.find((g) => g.id === id)!
  const t = 2.5 / Math.hypot(ORIGIN.x - r.x, ORIGIN.z - r.z)
  return { x: r.x + (ORIGIN.x - r.x) * t, z: r.z + (ORIGIN.z - r.z) * t }
}

export const travelTicks = (a: { x: number; z: number }, b: { x: number; z: number }) =>
  Math.max(2, Math.round(Math.hypot(a.x - b.x, a.z - b.z) * TICKS_PER_UNIT))

export const usersKey = (id: RegionId) => `users-${id}`
export const edgeKey = (id: RegionId) => `edge-${id}`
export const regionOf = (key: string | undefined) => REGIONS.find((r) => key === usersKey(r.id))?.id

// Where to draw each node, by key.
export function spotOf(key: string): { x: number; z: number } | undefined {
  if (key === 'origin') return ORIGIN
  for (const r of REGIONS) {
    if (key === usersKey(r.id)) return r
    if (key === edgeKey(r.id)) return edgeSpot(r.id)
  }
  return undefined
}

export const tagAbove = (spot: { x: number; z: number }, y: number): V3 => [spot.x, y, spot.z]
