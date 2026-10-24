// Where things stand on the floor. Two regions side by side, each with its
// users and a database; the link between the databases runs across:
//
//   users ─▶ West database
//                 ┆  link
//   users ─▶ East database

import type { V3 } from '../../core/types'

export const REGIONS = ['west', 'east'] as const
export type Region = (typeof REGIONS)[number]

export const REGION_NAMES: Record<Region, string> = { west: 'West', east: 'East' }
export const other = (r: Region): Region => (r === 'west' ? 'east' : 'west')

export const DB = { r: 0.9, h: 1.6 }
export const DB_X = 0
export const USERS_X = -7
const ROW_Z: Record<Region, number> = { west: -4, east: 4 }

export const TICKS_PER_SECOND = 20
export const MS_PER_TICK = 1000 / TICKS_PER_SECOND

export const usersKey = (r: Region) => `users-${r}`
export const dbKey = (r: Region) => r
export const regionOfDb = (key: string): Region | undefined => (key === 'west' || key === 'east' ? key : undefined)

export const usersSpot = (r: Region) => ({ x: USERS_X, z: ROW_Z[r] })
export const dbSpot = (r: Region) => ({ x: DB_X, z: ROW_Z[r] })

export function spotOf(key: string): { x: number; z: number } | undefined {
  if (key === 'west' || key === 'east') return dbSpot(key)
  if (key === 'users-west') return usersSpot('west')
  if (key === 'users-east') return usersSpot('east')
  return undefined
}

export const above = (r: Region, dy = 0.6): V3 => {
  const s = dbSpot(r)
  return [s.x, DB.h + dy, s.z]
}

// Busier than this, and a database turns red.
export const HOT = 0.85
