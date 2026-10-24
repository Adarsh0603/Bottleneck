// Where things stand on the floor. The order service on the left, the channel
// in the middle, and one row of consumers for each team on the right. Each
// team's first consumer is nearest the middle, and more are added outward:
//
//                                          Email consumer 4
//                                          Email consumer 3
//                                          Email consumer 2
//                                          Email consumer 1
//   orders          channel                Analytics
//                                          Inventory consumer 1
//                                          Inventory consumer 2
//                                          Inventory consumer 3
//                                          Inventory consumer 4

import { HALF } from '../../core/build/types'
import type { V3 } from '../../core/types'
import { MAX_CONSUMERS, TEAMS, type Mode, type Team } from './bus'

export const ORDERS = { x: -8.4, z: 0 }
export const CHANNEL = { x: -3.4, z: 0 }
export const TEAM_X = 3.4
export const SERVER = { w: 1.1, h: 1.5 }
export const PAD = 1.9 // the gap between a team's consumers

export const CONSUMER_Z: Record<Team, number[]> = {
  email: Array.from({ length: MAX_CONSUMERS.email }, (_, i) => -2.8 - PAD * i),
  stats: [0],
  stock: Array.from({ length: MAX_CONSUMERS.stock }, (_, i) => 2.8 + PAD * i),
}

export const consumerKey = (team: Team, i: number) => `${team}-${i}`

export function teamOf(key: string): { team: Team; index: number } | undefined {
  const [team, i] = key.split('-')
  return (TEAMS as string[]).includes(team) ? { team: team as Team, index: Number(i) } : undefined
}

export function spotOf(key: string): { x: number; z: number } | undefined {
  if (key === 'orders') return ORDERS
  if (key === 'channel') return CHANNEL
  const c = teamOf(key)
  return c ? { x: TEAM_X, z: CONSUMER_Z[c.team][c.index] } : undefined
}

// How far a piece reaches from its middle: where events leave and arrive.
export function halfOf(key: string, mode: Mode): number {
  if (key === 'orders') return HALF.app
  if (key === 'channel') return HALF[mode]
  return HALF.server
}

export const aboveConsumer = (team: Team, i: number, dy = 0.7): V3 => [TEAM_X, SERVER.h + dy, CONSUMER_Z[team][i]]

export const MS_PER_TICK = 1000 / 20

// What an event looks like: one shade for each product (undefined is hollow).
export const PRODUCT_FILL = ['var(--fg)', 'var(--muted)', undefined]
