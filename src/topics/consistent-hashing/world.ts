// Where things stand on the floor. Users and the app on a line; the cache
// servers around a ring, with the database in its middle:
//
//                         server
//   users        app    server  db  server
//                         server

import type { V3 } from '../../core/types'
import { MAX_NODES, pointSpot } from './ring'
import { TICKS_PER_SECOND } from '../../core/flow/time'

export const USERS = { x: -8, z: 0 }
export const APP = { x: -5, z: 0, w: 1.5, h: 1.5 }
export const RING = { x: 4.2, z: 0, r: 4 }
export const DB = { x: RING.x, z: RING.z, r: 0.8, h: 1.5 }
export const NODE = { r: 0.85, h: 1.3 }

export { TICKS_PER_SECOND }
export const MS_PER_TICK = 1000 / TICKS_PER_SECOND

export const nodeKey = (i: number) => `node-${i}`
export const nodeIndex = (key: string) => (key.startsWith('node-') ? Number(key.slice(5)) : -1)

// A spot on the ring, 0–1 clockwise as seen on screen, as a floor point.
export function onRing(at: number, r = RING.r): { x: number; z: number } {
  const a = at * Math.PI * 2
  return { x: RING.x + r * Math.cos(a), z: RING.z + r * Math.sin(a) }
}

// Where a server stands: evenly around the ring when hashing by remainder,
// at its first point on the ring when using the ring.
export function nodeSpot(i: number, count: number, ring: boolean) {
  if (ring) return onRing(pointSpot(i, 0))
  // Start at the left of the ring, so servers fan out away from the app.
  return onRing(0.5 + i / Math.max(1, count))
}

export const aboveNode = (i: number, count: number, ring: boolean, dy = 0.6): V3 => {
  const s = nodeSpot(i, count, ring)
  return [s.x, NODE.h + dy, s.z]
}

export const ALL_NODES = Array.from({ length: MAX_NODES }, (_, i) => i)

// Busier than this, and a server turns red.
export const HOT = 0.85
