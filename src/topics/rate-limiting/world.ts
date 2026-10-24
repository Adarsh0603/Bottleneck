// Where things stand on the floor. Three clients on the left, a balancer in
// front of up to three gateways (each with a rate limiter), and the API on the
// right. Gateways that share a counter reach one on the far side.
//
//   A ─┐            ┌ gateway 1 ┐
//   B  ─┼── balancer ┼ gateway 2 ┼──▶ API
//   Bot ─┘            └ gateway 3 ┘

import type { PieceKind } from '../../core/build/types'
import { HALF } from '../../core/build/types'
import type { V3 } from '../../core/types'
import { CLIENTS, type Client } from './gate'

export const CLIENT_X = -8.6
export const CLIENT_Z: Record<Client, number> = { ann: -3.4, bo: 0, bot: 3.4 }
export const BALANCER = { x: -5.4, z: 0 }
export const GATE_X = -1.8
export const API = { x: 5.4, z: 0 }
export const COUNTER = { x: 1.4, z: -6 }

export const gateZ = (i: number, n: number) => (n === 1 ? 0 : n === 2 ? (i === 0 ? -1.7 : 1.7) : (i - 1) * 3.4)

export const MS_PER_TICK = 1000 / 20

export interface Spot {
  kind: PieceKind
  x: number
  z: number
}

// Where a node stands, given how many gateways run.
export function spotOf(key: string, gateways: number): Spot | undefined {
  if (key === 'api') return { kind: 'app', ...API }
  if (key === 'lb') return { kind: 'balancer', ...BALANCER }
  if (key === 'counter') return { kind: 'cache', ...COUNTER }
  if ((CLIENTS as readonly string[]).includes(key)) return { kind: 'users', x: CLIENT_X, z: CLIENT_Z[key as Client] }
  const gate = /^gate-(\d)$/.exec(key)
  if (gate) return { kind: 'limiter', x: GATE_X, z: gateZ(Number(gate[1]), gateways) }
  return undefined
}

export const exitOf = (s: Spot): V3 => [s.x + HALF[s.kind], 0, s.z]
export const entryOf = (s: Spot): V3 => [s.x - HALF[s.kind] - 0.15, 0, s.z]
export const above = (s: Spot, dy: number): V3 => [s.x, dy, s.z]
