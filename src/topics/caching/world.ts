// Where things stand on the floor: everything sits on one line, z = 0.
//
//   users      app servers      cache        database
//   x=-7.5     x=-3.8           x=0.2        x=4.8

import type { V3 } from '../../core/types'
import type { CachingSim } from './engine'
import { NODES } from './engine'

export const USERS_X = -7.5
export const APP = { x: -3.8, w: 1.5, d: 1.5, h: 1.5 }
export const CACHE = { x: 0.2, w: 1.9, d: 1.9, h: 0.55 }
export const DB = { x: 4.8, r: 0.85, h: 1.7 }

export const CUBE = 0.24
export const FLY_Y = 0.6
export const QUEUE_GAP = 0.3
export const HIT_SECONDS = 0.6
export const FALL_SECONDS = 1.4

// Entry and exit points along the line.
const EXIT: Record<string, number> = {
  [NODES.users]: USERS_X + 1.1,
  [NODES.app]: APP.x + APP.w / 2,
  [NODES.cache]: CACHE.x + CACHE.w / 2,
}
const ENTRY: Record<string, number> = {
  [NODES.app]: APP.x - APP.w / 2,
  [NODES.cache]: CACHE.x - CACHE.w / 2,
  [NODES.db]: DB.x - DB.r - 0.15,
}

// Spot `k` in the line of lookups waiting in front of the database.
export function dbQueueSpot(k: number): V3 {
  return [DB.x - DB.r - 0.3 - k * QUEUE_GAP, CUBE / 2, 0]
}

// The cache's memory, drawn as cells on its lid: 8 per row, up to 40.
export const CELL_COLS = 8
export function cellSpot(i: number): V3 {
  const col = i % CELL_COLS
  const row = Math.floor(i / CELL_COLS)
  return [CACHE.x - 0.7 + col * 0.2, CACHE.h, -0.6 + row * 0.3]
}

// Where the waiting (coalesced) requests stack up, beside the cache.
export const WAIT_SPOT: V3 = [CACHE.x, 0, 1.35]

const lerp = (a: number, b: number, t: number) => a + (b - a) * t

export function flightPoint(from: string, to: string, p: number, jobId: number): V3 {
  const x0 = EXIT[from] ?? 0
  const x1 = ENTRY[to] ?? 0
  const jitter = (((jobId * 37) % 7) - 3) * 0.05
  return [lerp(x0, x1, p), FLY_Y + Math.sin(p * Math.PI) * 0.3, jitter]
}

// A hit bounces from the cache back toward the app servers.
export function hitPoint(age: number, jobId: number): V3 {
  const t = Math.min(1, age / HIT_SECONDS)
  const jitter = (((jobId * 37) % 7) - 3) * 0.05
  return [lerp(ENTRY[NODES.cache], EXIT[NODES.app], t), FLY_Y + Math.sin(t * Math.PI) * 0.5, jitter]
}

export function dropPoint(node: string, age: number, jobId: number): V3 {
  const side = jobId % 2 === 0 ? 1 : -1
  const [x0] = node === NODES.db ? dbQueueSpot(8) : [ENTRY[node] ?? 0]
  return [x0 - age * 0.6, FLY_Y + age * 1.2 - 5 * age * age, side * (0.15 + age * 0.9)]
}

export const dbOverloaded = (sim: CachingSim) => sim.db.queue.length >= sim.db.queueLimit * 0.75
