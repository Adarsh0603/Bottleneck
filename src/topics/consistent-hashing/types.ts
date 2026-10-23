import type { BaseBeat, Chapter } from '../../core/types'
import type { ConsistentMetrics, ConsistentSim } from './engine'
import type { Mode } from './ring'

export interface ConsistentState {
  rps: number
  nodes: number // cache servers, 2–6
  mode: Mode
  points: number // spots each server takes on the ring (1–16)
  down: number | null // a dead server
}

export type TagId = 'users' | 'app' | 'servers' | 'db' | 'items' | 'load'
export type HudId = 'traffic' | 'servers' | 'moved' | 'db' | 'spread' | 'errors'
export type ControlId = 'nodes' | 'mode' | 'points'

export interface Beat extends BaseBeat<ConsistentState, ConsistentSim, ConsistentMetrics> {
  tags?: TagId[]
  hud?: HudId[]
  controls?: ControlId[]
  // Show the ring's position numbers.
  ring?: boolean
  // Show the items sitting on the ring.
  items?: boolean
  // Colour each server and its virtual nodes, so you can tell whose is whose.
  virtual?: boolean
  // An item to point out, by number.
  pick?: number
}

export type ConsistentChapter = Chapter<ConsistentState, Beat>
