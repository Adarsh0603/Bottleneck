import type { BaseBeat, Chapter } from '../../core/types'
import type { ShardingMetrics, ShardingSim } from './engine'

// What decides a user's shard: the first letter of their name, when they
// signed up, or their id scrambled by a hash.
export type ShardKey = 'name' | 'signup' | 'hash'

export interface ShardingState {
  rps: number
  shards: number // 1–6
  key: ShardKey
  celebrity: boolean // one user a big share of all requests are about
  cached: boolean // the app servers cache the celebrity's posts
  down: number | null // a dead shard
}

export type TagId = 'users' | 'app' | 'dbs' | 'keys' | 'load' | 'celebrity'
export type HudId = 'traffic' | 'shards' | 'load' | 'spread' | 'errors'
export type ControlId = 'shards' | 'key'

export interface Beat extends BaseBeat<ShardingState, ShardingSim, ShardingMetrics> {
  tags?: TagId[]
  hud?: HudId[]
  controls?: ControlId[]
}

export type ShardingChapter = Chapter<ShardingState, Beat>
