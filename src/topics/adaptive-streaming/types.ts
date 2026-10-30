import type { BaseBeat, Chapter } from '../../core/types'
import type { StreamMetrics, StreamSim } from './engine'

// How the video reaches the phone.
//   file:     one file, played as it downloads. The quality was fixed when it was made.
//   segments: the same video cut into 4-second pieces, fetched one at a time.
//   abr:      the pieces exist in several qualities, and the phone picks one per piece.
export type Mode = 'file' | 'segments' | 'abr'

// How the phone picks the next piece's quality.
//   throughput: from how fast the last piece arrived.
//   buffer:     from how much video it already holds.
export type Rule = 'throughput' | 'buffer'

// The connection: how fast it is over the length of the clip.
export type Net = 'fast' | 'steady' | 'dip' | 'tunnel' | 'slow'

export interface StreamState {
  watch: number // goes up each time the clip is watched again from the start
  round: number // goes up to start the counts again from zero
  mode: Mode
  rung: number // quality for file and segments: 0 = 240p ... 3 = 1080p
  rule: Rule
  calm: boolean // abr: move up one step at a time, on a smoothed speed
  start: 'low' | 'high' // abr: the quality of the first piece
  net: Net
}

export type TagId = 'parties' | 'pipe' | 'ladder' | 'buffer'
export type HudId = 'buffer' | 'picture' | 'stalls' | 'stalled' | 'switches' | 'start' | 'average' | 'speed'
export type ControlId = 'watch' | 'net' | 'mode' | 'rung' | 'rule' | 'calm' | 'start'

export interface Beat extends BaseBeat<StreamState, StreamSim, StreamMetrics> {
  tags?: TagId[]
  hud?: HudId[]
  controls?: ControlId[]
  nets?: Net[] // the choices shown by the `net` control
  rules?: Rule[] // the choices shown by the `rule` control
}

export type StreamChapter = Chapter<StreamState, Beat>
