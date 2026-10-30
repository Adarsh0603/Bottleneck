// Where things stand on the floor. Users and app servers on one line; the
// databases in a column across it, the primary in the middle and the
// replicas filling in on either side:
//
//                                   replica 3
//                                   replica 1
//   users        app servers        primary
//                                   replica 2
//                                   replica 4

import type { V3 } from '../../core/types'
import { TICKS_PER_SECOND } from '../../core/flow/time'

export const USERS = { x: -7.5, z: 0 }
export const APP = { x: -3.8, z: 0, w: 1.5, h: 1.5 }
export const DB_X = 2.4
export const PRIMARY = { r: 0.9, h: 1.8 }
export const REPLICA = { r: 0.7, h: 1.3 }
export const MAX_REPLICAS = 4

export { TICKS_PER_SECOND }
export const MS_PER_TICK = 1000 / TICKS_PER_SECOND

export const PRIMARY_KEY = 'primary'
export const replicaKey = (i: number) => `replica-${i}`
export const replicaIndex = (key: string) => (key.startsWith('replica-') ? Number(key.slice(8)) : -1)

// Replicas fill in from the middle out, so any count looks balanced.
const REPLICA_Z = [-2.7, 2.7, -5.4, 5.4]
export const replicaSpot = (i: number) => ({ x: DB_X, z: REPLICA_Z[i] })

export function spotOf(key: string): { x: number; z: number } | undefined {
  if (key === 'users') return USERS
  if (key === 'app') return APP
  if (key === PRIMARY_KEY) return { x: DB_X, z: 0 }
  const i = replicaIndex(key)
  return i >= 0 ? replicaSpot(i) : undefined
}

export const heightOf = (key: string) => (key === PRIMARY_KEY ? PRIMARY.h : REPLICA.h)

export const above = (key: string, dy = 0.6): V3 => {
  const s = spotOf(key)!
  return [s.x, heightOf(key) + dy, s.z]
}

// Busier than this, and a database turns red.
export const HOT = 0.85

// Longer than this, and the lag is trouble.
export const LAG_OK = 2
