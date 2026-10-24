import type { BaseBeat, Chapter } from '../../core/types'
import type { QueueMetrics, QueueSim } from './engine'

export interface QueueState {
  rps: number
  queued: boolean // a queue sits between the app and the workers
  workers: number // 1–6
  flaky: boolean // some jobs fail
  retries: number // how many times a failed job is tried again, 0–3
  deadLetter: boolean // jobs that give up are parked, not thrown away
}

export type TagId = 'users' | 'app' | 'queue' | 'workers' | 'load' | 'dead'
export type HudId = 'errors' | 'response' | 'backlog' | 'wait' | 'done' | 'load' | 'lost' | 'stuck'
export type ControlId = 'queue' | 'workers' | 'retries' | 'deadLetter'

export interface Beat extends BaseBeat<QueueState, QueueSim, QueueMetrics> {
  tags?: TagId[]
  hud?: HudId[]
  controls?: ControlId[]
}

export type QueueChapter = Chapter<QueueState, Beat>
