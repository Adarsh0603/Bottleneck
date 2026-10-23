import type { BaseBeat, Chapter } from '../../core/types'
import type { AutoscaleMetrics, AutoscaleSim } from './engine'

export type Pattern = 'steady' | 'day' | 'spike'

export interface AutoscaleState {
  pattern: Pattern
  rps: number // steady traffic only
  servers: number // fleet size by hand, while the autoscaler is off
  auto: boolean
  target: number // % busy the autoscaler aims for
  min: number // the autoscaler never goes below this
  bootSeconds: number
}

export type TagId = 'users' | 'lb' | 'servers' | 'idle' | 'autoscaler'
export type HudId = 'clock' | 'traffic' | 'servers' | 'busy' | 'errors' | 'cost'
export type ControlId = 'target'

export interface Beat extends BaseBeat<AutoscaleState, AutoscaleSim, AutoscaleMetrics> {
  tags?: TagId[]
  hud?: HudId[]
  controls?: ControlId[]
}

export type AutoscaleChapter = Chapter<AutoscaleState, Beat>
