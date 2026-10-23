import type { FlowSim } from '../flow/engine'
import type { Shot } from '../types'

// "Build it": the learner drags pieces onto pads on the floor, and traffic
// flows through whatever they've assembled.

export type PieceKind = 'users' | 'balancer' | 'server' | 'app' | 'cache' | 'database' | 'replica' | 'autoscaler'

export const PIECE_NAMES: Record<PieceKind, string> = {
  users: 'Users',
  balancer: 'Load balancer',
  server: 'Server',
  app: 'App server',
  cache: 'Cache',
  database: 'Database',
  replica: 'Read replica',
  autoscaler: 'Autoscaler',
}

// Half the footprint of each piece: where requests leave and arrive.
export const HALF: Record<PieceKind, number> = {
  users: 0.95,
  balancer: 0.65,
  server: 0.55,
  app: 0.75,
  cache: 0.95,
  database: 0.85,
  replica: 0.65,
  autoscaler: 0.6,
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
  latency: Record<string, number> // source key → recent average response, ms
}

// A number the learner can adjust once a piece is placed, e.g. cache size.
export interface BuildSetting {
  id: string
  label: string // singular unit, e.g. "item"
  when: PieceKind
  min: number
  max: number
  step: number
  initial: number
}

export type Settings = Record<string, number>

// A live number shown at the top: busy-ness of one node, response time of
// one source, or (by default) the busiest server.
export type Watch =
  | { kind: 'busy'; key: string; label: string }
  | { kind: 'latency'; key: string; label: string; limitMs: number }

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
  settings?: BuildSetting[]
  watch?: Watch[]
  // Turn a placement into a running system. Node keys are the fixed pieces'
  // and pads' ids, so the scene knows where to draw each node. A node the
  // system adds on an empty pad by itself (an autoscaler's server) is drawn
  // as the first piece that pad accepts.
  assemble: (placed: Placement, settings: Settings, rng?: () => number) => FlowSim
  // `flow` is the running system, for goals the numbers alone can't judge.
  check: (m: BuildMetrics, placed: Placement, settings: Settings, flow?: FlowSim) => boolean
}
