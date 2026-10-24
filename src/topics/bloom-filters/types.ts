import type { BaseBeat, Chapter } from '../../core/types'
import type { BloomMetrics, BloomSim } from './engine'

// Which name the next check is for. `mix` is a steady stream: `taken` percent of
// the names are saved ones, the rest are new.
//   new:        a new name the filter will say no to
//   lookalike:  a new name that lands on switches already on
//   taken:      a saved name
//   friend:     a saved name that shared a switch with the one just deleted
export type Kind = 'new' | 'lookalike' | 'taken' | 'friend' | 'mix'

export interface BloomState {
  ask: number // goes up each time the form checks one name
  kind: Kind // what the checks made by `ask` are for
  pace: number // automatic checks per second; 0 = only when `ask` goes up
  taken: number // percent of automatic checks that are for saved names
  filter: boolean // the filter sits in front of the database
  bits: number // switches in the filter
  hashes: number // switches each name turns on
  names: number // names saved in the database
  counting: boolean // each switch keeps a count, so a name can be removed
  drop: number // goes up each time a saved name is deleted
  round: number // goes up to start the counts again from zero
}

export type TagId = 'parties' | 'verdict' | 'queue' | 'victim'
export type HudId = 'asked' | 'trips' | 'skipped' | 'wasted' | 'waiting' | 'wrong' | 'fill' | 'fp'
export type ControlId = 'check' | 'lookalike' | 'friend' | 'filter' | 'bits' | 'hashes' | 'names' | 'counting' | 'delete' | 'traffic'

export interface Beat extends BaseBeat<BloomState, BloomSim, BloomMetrics> {
  tags?: TagId[]
  hud?: HudId[]
  controls?: ControlId[]
}

export type BloomChapter = Chapter<BloomState, Beat>
