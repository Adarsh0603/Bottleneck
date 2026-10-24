// Where things stand on the floor. Users on the left, the shop in front of
// them, and the two services it calls on the right. A breaker, when there is
// one, stands on each road to a service.
//
//                       ┌─▶ Payments
//   users ──▶ shop ─────┤
//                       └─▶ Reviews

import type { PieceKind } from '../../core/build/types'
import { HALF } from '../../core/build/types'
import type { V3 } from '../../core/types'
import type { Dep } from './shop'

export const USERS = { x: -8.6, z: 0 }
export const SHOP = { x: -3.4, z: 0 }
export const DEP_AT: Record<Dep, { x: number; z: number }> = { pay: { x: 4.2, z: -2.5 }, rev: { x: 4.2, z: 2.7 } }
// On the straight road from the shop to each service.
export const GATE_AT: Record<Dep, { x: number; z: number }> = { pay: { x: 0.4, z: -1.3 }, rev: { x: 0.4, z: 1.4 } }

export const MS_PER_TICK = 1000 / 20

export interface Spot {
  kind: PieceKind
  x: number
  z: number
}

export function spotOf(key: string): Spot | undefined {
  if (key === 'users') return { kind: 'users', ...USERS }
  if (key === 'shop') return { kind: 'app', ...SHOP }
  if (key === 'pay' || key === 'rev') return { kind: 'app', ...DEP_AT[key] }
  if (key === 'gate-pay') return { kind: 'breaker', ...GATE_AT.pay }
  if (key === 'gate-rev') return { kind: 'breaker', ...GATE_AT.rev }
  return undefined
}

export const exitOf = (s: Spot): V3 => [s.x + HALF[s.kind], 0, s.z]
export const entryOf = (s: Spot): V3 => [s.x - HALF[s.kind] - 0.15, 0, s.z]
export const above = (s: Spot, dy: number): V3 => [s.x, dy, s.z]
