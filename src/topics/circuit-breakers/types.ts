import type { BaseBeat, Chapter } from '../../core/types'
import type { Backoff, Mode } from './shop'
import type { ShopMetrics, ShopSim } from './engine'

export interface ShopState {
  pay: Mode
  rev: Mode
  reviews: boolean // a product page asks Reviews
  timeout: number // seconds; 0 waits as long as it takes
  retries: number
  backoff: Backoff
  breaker: boolean // a breaker on each dependency
  trip: number
  cooldown: number
  fallback: boolean
  pool: number // threads one dependency may hold; 0 is no limit
  threads: number
}

export type TagId = 'users' | 'shop' | 'pay' | 'rev' | 'breaker' | 'threads'
export type HudId = 'browse' | 'checkout' | 'threads' | 'wait' | 'load' | 'shed'
export type ControlId = 'threads' | 'timeout' | 'retries' | 'backoff' | 'breaker' | 'trip' | 'cooldown' | 'fallback' | 'pool'

export interface Beat extends BaseBeat<ShopState, ShopSim, ShopMetrics> {
  tags?: TagId[]
  hud?: HudId[]
  controls?: ControlId[]
}

export type ShopChapter = Chapter<ShopState, Beat>
