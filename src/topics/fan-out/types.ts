import type { BaseBeat, Chapter } from '../../core/types'
import type { FanoutMetrics, FanoutSim } from './engine'

// How a post reaches the people who follow its author.
//   read:   nothing happens at posting time. The feed is built when it is opened.
//   write:  every post is copied into each follower's inbox when it is made.
//   hybrid: normal accounts are copied into inboxes, celebrities are looked up on open.
export type Mode = 'read' | 'write' | 'hybrid'

export interface FanoutState {
  open: number // goes up each time the reader opens the app
  pace: number // automatic opens per second; 0 = only when `open` goes up
  posting: number // posts per second from normal accounts; 0 = quiet
  follows: number // people the reader follows
  round: number // goes up to start the counts again from zero
  mode: Mode
  celeb: boolean // one of the people the reader follows is a celebrity
  star: number // goes up each time the celebrity posts
  skipIdle: boolean // do not write to the inboxes of followers who have been away
}

export type TagId = 'parties' | 'queue' | 'backlog'
export type HudId = 'opened' | 'wait' | 'lookups' | 'queue' | 'posted' | 'writes' | 'backlog' | 'slowest'
export type ControlId = 'open' | 'follows' | 'modeRW' | 'mode' | 'celeb' | 'idle'

export interface Beat extends BaseBeat<FanoutState, FanoutSim, FanoutMetrics> {
  tags?: TagId[]
  hud?: HudId[]
  controls?: ControlId[]
}

export type FanoutChapter = Chapter<FanoutState, Beat>
