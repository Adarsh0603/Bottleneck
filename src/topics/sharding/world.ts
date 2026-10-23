// Where things stand on the floor. Users and app servers on one line; the
// shards in a column across it, centred on that line:
//
//                                   shard 1
//   users        app servers        shard 2
//                                   shard 3

import type { V3 } from '../../core/types'

export const USERS = { x: -7.5, z: 0 }
export const APP = { x: -3.8, z: 0, w: 1.5, h: 1.5 }
export const DB_X = 2.4
export const SHARD = { r: 0.75, h: 1.4 }
export const MAX_SHARDS = 6
const GAP = 2.3

export const TICKS_PER_SECOND = 20
export const MS_PER_TICK = 1000 / TICKS_PER_SECOND

export const shardKey = (i: number) => `shard-${i}`
export const shardIndex = (key: string) => (key.startsWith('shard-') ? Number(key.slice(6)) : -1)

// Shard i of n, the column centred on the app's line.
export const shardSpot = (i: number, n: number) => ({ x: DB_X, z: (i - (n - 1) / 2) * GAP })

export const aboveShard = (i: number, n: number, dy = 0.6): V3 => {
  const s = shardSpot(i, n)
  return [s.x, SHARD.h + dy, s.z]
}

// Busier than this, and a shard turns red.
export const HOT = 0.85
