// Where things stand on the floor. The servers sit in a ring, the two
// customers wait on the left:
//
//   Ana ─┐        ◯ ◯
//        ├─▶    ◯     ◯     (a ring of 3 or 5 servers)
//   Ben ─┘        ◯

import type { V3 } from '../../core/types'
import { TICKS_PER_SECOND } from '../../core/flow/time'

export type Client = 'ana' | 'ben'
export const CLIENTS: Client[] = ['ana', 'ben']
export const CLIENT_NAMES: Record<Client, string> = { ana: 'Ana', ben: 'Ben' }
export const CLIENT_COLOR: Record<Client, string> = { ana: 'var(--srv-1)', ben: 'var(--srv-2)' }
// Messages to and from a customer use these in place of a server's number.
export const CLIENT_ID: Record<Client, number> = { ana: -1, ben: -2 }
export const clientOf = (id: number): Client | undefined => (id === CLIENT_ID.ana ? 'ana' : id === CLIENT_ID.ben ? 'ben' : undefined)

export const MAX_NODES = 5
export { TICKS_PER_SECOND }
export const MS_PER_TICK = 1000 / TICKS_PER_SECOND

export const NODE = { r: 0.8, h: 1.1 }
const RING = 3.4
const CLIENTS_X = -8.2

export function nodeSpot(id: number, size: number): { x: number; z: number } {
  const a = (id / size) * Math.PI * 2 - Math.PI / 2 + (size === 3 ? Math.PI / 6 : 0)
  return { x: Math.cos(a) * RING, z: Math.sin(a) * RING }
}

export const clientSpot = (c: Client) => ({ x: CLIENTS_X, z: c === 'ana' ? -1.6 : 1.6 })

export function spotOf(id: number, size: number): { x: number; z: number } {
  const c = clientOf(id)
  return c ? clientSpot(c) : nodeSpot(id, size)
}

export const above = (id: number, size: number, dy = 0.7): V3 => {
  const s = nodeSpot(id, size)
  return [s.x, NODE.h + dy, s.z]
}
