import type { BaseBeat, Chapter } from '../../core/types'
import type { Commit, KeyBy, Mode } from './bus'
import type { BusMetrics, BusSim } from './engine'

export interface BusState {
  rps: number
  mode: Mode
  // Consumers each team runs. 0 means that team isn't listening at all.
  email: number
  stats: number
  stock: number
  partitions: number // 1–4
  key: KeyBy
  retention: number // seconds the log keeps events
  commit: Commit // when a consumer tells the log it is done
  dedupe: boolean // skip an event it has already handled
  outages: boolean // Analytics goes offline now and then
  crashes: boolean // Inventory's consumer crashes now and then
}

export type TagId = 'orders' | 'channel' | 'email' | 'stats' | 'stock' | 'behind' | 'offsets' | 'products'
export type HudId = 'missed' | 'behind' | 'order' | 'lost' | 'doubled' | 'done'
export type ControlId = 'mode' | 'email' | 'stock' | 'partitions' | 'key' | 'retention' | 'commit' | 'dedupe'

export interface Beat extends BaseBeat<BusState, BusSim, BusMetrics> {
  tags?: TagId[]
  hud?: HudId[]
  controls?: ControlId[]
}

export type BusChapter = Chapter<BusState, Beat>
