import type { BaseBeat, Chapter } from '../../core/types'
import type { RealtimeMetrics, RealtimeSim } from './engine'

// How the phone learns that a message is waiting.
//   manual: only when you pull to refresh.
//   poll:   it asks the server every few seconds.
//   long:   it asks, and the server holds the ask until there is news.
//   sse:    it opens one connection, and the server writes into it (one way).
//   ws:     it opens one connection that both sides write into.
export type Mode = 'manual' | 'poll' | 'long' | 'sse' | 'ws'

export interface RealtimeState {
  send: number // goes up each time the friend sends a message
  talk: number // messages per second the friend sends on their own; 0 = only when `send` goes up
  check: number // goes up each time the phone pulls to refresh
  reply: number // goes up each time the phone sends a message back
  round: number // goes up to start the counts again from zero
  mode: Mode
  interval: number // seconds between asks when polling
  phones: number // 1 = the single phone; more = a crowd, each holding a connection
  servers: number // servers the crowd's connections are spread over
  flaky: boolean // phones drop out without a goodbye now and then
  heartbeat: boolean // the server pings, and closes connections that stop answering
  backoff: boolean // phones that lost their connection wait a random, growing time before retrying
  crash: number // goes up to crash one server
}

export type TagId = 'parties' | 'held' | 'crowd'
export type HudId = 'shown' | 'delay' | 'requests' | 'empty' | 'sent' | 'connected' | 'dead' | 'waiting'
export type ControlId =
  | 'send'
  | 'check'
  | 'reply'
  | 'mode'
  | 'interval'
  | 'phones'
  | 'servers'
  | 'flaky'
  | 'heartbeat'
  | 'backoff'
  | 'crash'

export interface Beat extends BaseBeat<RealtimeState, RealtimeSim, RealtimeMetrics> {
  tags?: TagId[]
  hud?: HudId[]
  controls?: ControlId[]
  modes?: Mode[] // the choices shown by the `mode` control
}

export type RealtimeChapter = Chapter<RealtimeState, Beat>
