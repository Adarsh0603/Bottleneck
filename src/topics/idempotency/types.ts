import type { BaseBeat, Chapter } from '../../core/types'
import type { IdempotencyMetrics, IdempotencySim } from './engine'

// What the network does to the first try of each payment.
export type Lose = 'none' | 'request' | 'reply'
// What the action does to the ledger: add a charge, or set the order to paid.
export type Op = 'add' | 'set'
// How the server remembers a key: not at all, look it up before charging, or
// claim it in one step before doing anything.
export type Keys = 'none' | 'check' | 'atomic'

export interface IdempotencyState {
  tap: number // goes up each time the customer taps Pay (or the queue sends)
  pace: number // automatic taps per second; 0 = only when `tap` goes up
  lose: Lose
  retry: boolean // the sender tries again when no answer comes
  op: Op
  keys: Keys
  double: boolean // every tap sends the request twice, at once
  crash: boolean // Payments crashes right after the first try is charged
  together: boolean // the charge and the key are saved in one step
  sender: 'phone' | 'queue'
}

export type TagId = 'parties' | 'status' | 'keys' | 'lost' | 'retry' | 'dupe' | 'replay' | 'crash'
export type HudId = 'paid' | 'charges' | 'dupes' | 'waiting' | 'retries' | 'replays'
export type ControlId = 'pay' | 'faults' | 'retry' | 'op' | 'keys' | 'together'

export interface Beat extends BaseBeat<IdempotencyState, IdempotencySim, IdempotencyMetrics> {
  tags?: TagId[]
  hud?: HudId[]
  controls?: ControlId[]
}

export type IdempotencyChapter = Chapter<IdempotencyState, Beat>
