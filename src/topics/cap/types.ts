import type { BaseBeat, Chapter } from '../../core/types'
import type { CapMetrics, CapSim } from './engine'

// What a region does with requests it can't confirm while the link is cut.
export type Mode = 'consistent' | 'available'

export interface CapState {
  rps: number // per region
  partitioned: boolean // the link between the regions is cut
  mode: Mode
}

export type TagId = 'users' | 'dbs' | 'link' | 'stale' | 'conflict'
export type HudId = 'mix' | 'errors' | 'stale' | 'conflicts' | 'link'
export type ControlId = 'partition' | 'mode'

export interface Beat extends BaseBeat<CapState, CapSim, CapMetrics> {
  tags?: TagId[]
  hud?: HudId[]
  controls?: ControlId[]
}

export type CapChapter = Chapter<CapState, Beat>
