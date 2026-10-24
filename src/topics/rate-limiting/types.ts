import type { BaseBeat, Chapter } from '../../core/types'
import type { Algo, BotMode, Scope } from './gate'
import type { RateMetrics, RateSim } from './engine'

export interface RateState {
  limiting: boolean
  algo: Algo
  limit: number // requests a second
  burst: number // bucket size
  scope: Scope
  bot: BotMode
  annBursts: boolean
  gateways: number // 1–3
  shared: boolean // gateways share one counter
  apiQueue: number
}

export type TagId = 'clients' | 'limiter' | 'named' | 'api' | 'counter'
export type HudId = 'ann' | 'overload' | 'rejected' | 'bot' | 'wait'
export type ControlId = 'limiting' | 'limit' | 'scope' | 'algo' | 'burst' | 'counter'

export interface Beat extends BaseBeat<RateState, RateSim, RateMetrics> {
  tags?: TagId[]
  hud?: HudId[]
  controls?: ControlId[]
  // Which algorithms the learner may pick between, when `algo` is a control.
  algos?: Algo[]
}

export type RateChapter = Chapter<RateState, Beat>
