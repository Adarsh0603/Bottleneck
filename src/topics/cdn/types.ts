import type { BaseBeat, Chapter } from '../../core/types'
import type { CdnMetrics, CdnSim } from './engine'
import type { RegionId } from './world'

export interface CdnState {
  rps: number // per region
  edges: Record<RegionId, boolean>
  purge: number // bump to empty every edge
}

export type TagId = 'origin' | 'regions' | 'edges'
export type HudId = 'latency' | 'hitrate' | 'origin' | 'edges'
export type ControlId = 'edges'

export interface Beat extends BaseBeat<CdnState, CdnSim, CdnMetrics> {
  tags?: TagId[]
  hud?: HudId[]
  controls?: ControlId[]
}

export type CdnChapter = Chapter<CdnState, Beat>
