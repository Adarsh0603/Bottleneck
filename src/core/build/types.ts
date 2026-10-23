import type { FlowSim } from '../flow/engine'
import type { Shot } from '../types'

// "Build it": the learner drags pieces onto pads on the floor, and traffic
// flows through whatever they've assembled.

export type PieceKind = 'users' | 'balancer' | 'server' | 'app' | 'cache' | 'database'

export const PIECE_NAMES: Record<PieceKind, string> = {
  users: 'Users',
  balancer: 'Load balancer',
  server: 'Server',
  app: 'App server',
  cache: 'Cache',
  database: 'Database',
}

// Half the footprint of each piece: where requests leave and arrive.
export const HALF: Record<PieceKind, number> = {
  users: 0.95,
  balancer: 0.65,
  server: 0.55,
  app: 0.75,
  cache: 0.95,
  database: 0.85,
}

// A spot on the floor where pieces can be dropped.
export interface Pad {
  id: string
  x: number
  z: number
  accepts: PieceKind[]
}

// Something already in place that can't be moved, like the users.
export interface FixedPiece {
  id: string
  kind: PieceKind
  x: number
  z: number
}

// Which piece sits on each pad, by pad id.
export type Placement = Record<string, PieceKind>

export interface BuildMetrics {
  dropRate: number // percent, over the last few seconds
  avgMs: number
  busy: Record<string, number> // node key → how busy its workers were, 0–1
  busiest: number // the highest of those
}

export interface BuildTask {
  title: string
  sub: string
  goal: string
  win: string
  holdSeconds: number
  rps: number
  shot: Shot
  fixed: FixedPiece[]
  pads: Pad[]
  toolbox: { kind: PieceKind; count: number }[]
  // Turn a placement into a running system. Node keys are the fixed pieces'
  // and pads' ids, so the scene knows where to draw each node.
  assemble: (placed: Placement, rng?: () => number) => FlowSim
  check: (m: BuildMetrics, placed: Placement) => boolean
}
