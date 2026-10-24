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
  hasty: number[] // servers that lose patience at once when this list changes
  strand: boolean // the current leader is cut off from every other server
}

export type TagId = 'clients' | 'nodes' | 'leader' | 'clash' | 'heartbeat' | 'terms' | 'timers' | 'votes' | 'split' | 'holders'
export type HudId = 'confirmed' | 'clashes' | 'leader' | 'waiting' | 'stall' | 'term' | 'holders'
export type ControlId = 'rule' | 'crash' | 'split' | 'spread'

export interface Beat extends BaseBeat<ConsensusState, ConsensusSim, ConsensusMetrics> {
  tags?: TagId[]
  hud?: HudId[]
  controls?: ControlId[]
  noCopyLabel?: boolean // leave the 'Copying' label off messages that carry a booking
}

export type ConsensusChapter = Chapter<ConsensusState, Beat>
