import type { BaseBeat, Chapter } from '../../core/types'
import type { TransactionsMetrics, TransactionsSim } from './engine'

// How Orders keeps the three services together:
//   - naive: ask each in turn and hope.
//   - 2pc: two-phase commit. Everyone prepares and locks, then all commit or all abort.
//   - saga: each service commits at once; if one fails, the finished ones are undone.
export type Mode = 'naive' | '2pc' | 'saga'
// Which service refuses its part of every order.
export type Fail = 'none' | 'stock' | 'pay' | 'ship'

export interface TransactionsState {
  tap: number // goes up each time the customer places an order
  pace: number // automatic rounds per second; 0 = only when `tap` goes up
  batch: number // orders placed together in each automatic round
  mode: Mode
  fail: Fail
  crash: boolean // Orders crashes in the middle of every other order, starting with the first
  keys: boolean // services spot a repeated step by its idempotency key and do not redo it
  log: boolean // a saga writes its progress down before each step, so it can carry on after a crash
}

export type TagId = 'parties' | 'status' | 'msgs' | 'crash' | 'log' | 'repeat'
export type HudId = 'committed' | 'aborted' | 'broken' | 'locked' | 'stalled' | 'undone' | 'doubles'
export type ControlId = 'order' | 'mode' | 'fail' | 'crash' | 'log' | 'keys'

export interface Beat extends BaseBeat<TransactionsState, TransactionsSim, TransactionsMetrics> {
  tags?: TagId[]
  hud?: HudId[]
  controls?: ControlId[]
}

export type TransactionsChapter = Chapter<TransactionsState, Beat>
