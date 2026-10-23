// The autoscaling world: users on the left, a load balancer, and a row of six
// server slots on the right. A slot is empty, booting, running or shutting
// down. Traffic follows a pattern: steady, a whole day, or repeating spikes.

export const USERS = { x: -6.5, z: 0 }
export const LB = { x: -2.2, z: 0 }
export const SERVER_X = 3
export const SERVER = { w: 1.1, h: 1.5 }
export const MAX_SERVERS = 6
const SPACING = 1.7
// Slots fill from the middle out, so a small fleet sits in front of the balancer.
const FILL_ORDER = [2, 3, 1, 4, 0, 5]
export const slotZ = (slot: number) => (FILL_ORDER[slot] - (MAX_SERVERS - 1) / 2) * SPACING

export const TICKS_PER_SECOND = 20
export const MS_PER_TICK = 1000 / TICKS_PER_SECOND
export const TRIP_TICKS = 8

export const COST_PER_SERVER = 50 // $ a month

// A day of traffic, req/s at each hour. One second of play is one hour.
export const DAY = [3, 2.5, 2, 2, 2, 2.5, 3.5, 5, 7, 9, 10, 11, 11.5, 12, 12, 11.5, 11, 11.5, 12, 11, 9, 7, 5, 4]
export const START_HOUR = 6
export const SECONDS_PER_HOUR = 1

// Quiet traffic, then a sudden spike, over and over.
export const SPIKE = { quiet: 4, peak: 13, quietSeconds: 12, peakSeconds: 10 }

export const serverKey = (slot: number) => `server-${slot}`
export const slotOf = (key: string) => (key.startsWith('server-') ? Number(key.slice(7)) : undefined)

// Where to draw each node, by key.
export function spotOf(key: string): { x: number; z: number } | undefined {
  if (key === 'users') return USERS
  if (key === 'lb') return LB
  const slot = slotOf(key)
  return slot === undefined ? undefined : { x: SERVER_X, z: slotZ(slot) }
}
