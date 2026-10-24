import type { BaseBeat, Chapter } from '../../core/types'
import type { ConsensusMetrics, ConsensusSim } from './engine'

// Who is allowed to take a booking.
export type Rule = 'anyone' | 'leader'

export interface ConsensusState {
  size: 3 | 5 // servers in the ring
  pace: number // seat races per second: Ana and Ben both go for the same seat
  manual: boolean // no automatic races: one starts each time `again` goes up
  again: number
  rule: Rule
  elections: boolean // a server that stops hearing from a leader may start an election
  down: number[] // servers that have crashed
  split: number // servers cut off from the rest of the ring (the last ones); 0 = none
  timeout: number // seconds a follower waits for a heartbeat, at least
  spread: number // up to this many extra seconds, picked at random per server
}

export type TagId = 'clients' | 'nodes' | 'leader' | 'clash' | 'heartbeat'
export type HudId = 'confirmed' | 'clashes' | 'leader' | 'waiting' | 'stall'
export type ControlId = 'rule' | 'crash'

export interface Beat extends BaseBeat<ConsensusState, ConsensusSim, ConsensusMetrics> {
  tags?: TagId[]
  hud?: HudId[]
  controls?: ControlId[]
}

export type ConsensusChapter = Chapter<ConsensusState, Beat>
