import type { BaseBeat, Chapter } from '../../core/types'
import type { CachingMetrics, CachingSim } from './engine'

export interface CachingState {
  rps: number
  cache: boolean // is there a cache at all
  capacity: number // items it can hold
  ttl: number // seconds; 0 = never expires
  coalesce: boolean // misses for the same item wait for one fetch
  cacheDown: boolean
  viral: boolean // one item gets most of the traffic
}

export type TagId = 'app' | 'db' | 'cache' | 'hit' | 'miss' | 'queue' | 'dropped' | 'lru' | 'waiting' | 'users'

export type HudId = 'traffic' | 'latency' | 'hitrate' | 'dbload' | 'errors' | 'age'

export type ControlId = 'traffic' | 'size' | 'ttl' | 'coalesce'

export interface Beat extends BaseBeat<CachingState, CachingSim, CachingMetrics> {
  tags?: TagId[]
  hud?: HudId[]
  controls?: ControlId[]
}

export type CachingChapter = Chapter<CachingState, Beat>
