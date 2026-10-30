// Watching a video on a phone:
//
//   Server ══ network ══▶ Phone
//
// The phone downloads the video ahead of the playhead and keeps it in a buffer.
// Playing drains the buffer; downloading fills it. If it runs dry, the picture
// freezes: a stall.
//
//   file:     one file at one quality, downloaded as fast as the network allows.
//   segments: 4-second pieces, still one quality.
//   abr:      pieces in four qualities. After each piece the phone picks the
//             next one's quality, either from how fast the last piece arrived
//             (throughput) or from how much video it holds (buffer).
//
// Time here runs TIME_SCALE times faster than the clock, so a two-minute clip
// takes 15 seconds to watch.

import type { Net, StreamState } from './types'
import { TICKS_PER_SECOND } from './world'

const DT = 0.2 // seconds of video time per sub-step
const SUBSTEPS = 2 // sub-steps in one tick, so the clip plays faster than the clock
export const TIME_SCALE = DT * SUBSTEPS * TICKS_PER_SECOND

export const CLIP = 120 // seconds of video
export const SEG = 4 // seconds of video in a piece
export const MAX_BUF = 20 // the phone stops downloading when it holds this much
export const START = 4 // seconds of video held before the first frame plays
export const RESUME = 2 // seconds held before a frozen picture plays on

// The qualities, and the bandwidth each needs, in megabits a second.
export const RUNGS = [
  { label: '240p', mbps: 0.4 },
  { label: '480p', mbps: 1 },
  { label: '720p', mbps: 2.5 },
  { label: '1080p', mbps: 5 },
]

const SAFETY = 0.9 // the phone assumes the next piece gets this share of the last piece's speed
const CALM_SAFETY = 0.9
const UP_AFTER = 2 // calm: pieces in a row that fit a better quality before moving up
const CALM_UP_BUFFER = 8 // calm: seconds held before moving up
const SMOOTH = 0.35 // calm: weight of the newest piece in the speed it remembers

// The buffer rule: the more video held, the better the quality asked for.
const BUFFER_STEPS = [6, 11, 16]

// The connection's speed in megabits a second, `t` seconds into the clip.
function speed(net: Net, t: number): number {
  const wobble = (amp: number, rate: number) => 1 + amp * Math.sin(rate * t) * Math.sin(0.43 * rate * t + 1)
  switch (net) {
    case 'fast':
      return 10 * wobble(0.2, 1.9)
    case 'steady':
      return 3 * wobble(0.25, 1.9)
    case 'slow':
      return 0.8 * wobble(0.2, 1.9)
    case 'dip':
      return (t >= 30 && t < 60 ? 1 : 6) * wobble(0.25, 1.9)
    case 'tunnel':
      return (t % 45 >= 28 && t % 45 < 40 ? 0.1 : 4) * wobble(0.2, 1.9)
  }
}

interface Piece {
  rung: number
  secs: number
}

interface Fetch {
  rung: number
  bits: number
  got: number
  took: number
}

export interface StreamMetrics {
  buffer: number // seconds of video held
  shown: number // quality index of the picture on screen; -1 before the first frame
  stalls: number
  stalled: number // seconds spent frozen, not counting the wait at the start
  switches: number // times the picture changed quality
  start: number // seconds from pressing play to the first frame; -1 until then
  average: number // average megabits a second of the video shown so far
  speed: number // the connection now
  done: boolean // the whole clip was played
  playing: boolean
  frozen: boolean
}

export class StreamSim {
  tick = 0
  time = 0
  pieces: Piece[] = [] // what the phone holds, oldest first
  fetch: Fetch | null = null
  playhead = 0
  state: 'start' | 'playing' | 'frozen' | 'done' = 'start'

  private st: StreamState = { watch: 0, round: 0, mode: 'file', rung: 3, rule: 'throughput', calm: false, start: 'low', net: 'steady' }
  private cfg: string | null = null
  private watchHigh = 0
  private downloaded = 0
  private next = 0 // quality of the next piece, in abr
  private smooth = 0 // calm: the speed the phone remembers
  private fits = 0 // calm: pieces in a row that fit a better quality
  private stalls = 0
  private stalled = 0
  private switches = 0
  private start = -1
  private lastShown = -1
  private bitSum = 0
  private played = 0
  private bw = 0

  apply(st: StreamState) {
    const first = this.cfg === null
    const cfg = `${st.round}|${st.mode}|${st.net}|${st.start}`
    const restart = !first && (cfg !== this.cfg || st.watch > this.watchHigh)
    const prev = this.st
    this.st = st
    this.cfg = cfg
    if (first || restart) {
      this.reset()
      this.watchHigh = st.watch
    }
    if (!first && !restart && prev.rule !== st.rule) this.fits = 0
  }

  private reset() {
    this.tick = 0
    this.time = 0
    this.pieces = []
    this.fetch = null
    this.playhead = 0
    this.state = 'start'
    this.downloaded = 0
    this.next = this.st.start === 'low' ? 0 : RUNGS.length - 1
    this.smooth = 0
    this.fits = 0
    this.stalls = this.stalled = this.switches = 0
    this.start = -1
    this.lastShown = -1
    this.bitSum = this.played = 0
    this.bw = speed(this.st.net, 0)
  }

  private get over() {
    return this.state === 'done'
  }

  get buffer() {
    return this.pieces.reduce((n, p) => n + p.secs, 0)
  }

  private add(rung: number, secs: number) {
    const last = this.pieces[this.pieces.length - 1]
    if (last && last.rung === rung) last.secs += secs
    else this.pieces.push({ rung, secs })
    this.downloaded += secs
  }

  // After a piece arrives (abr): pick the quality of the next one.
  private choose(took: number, bits: number, held: number) {
    const { rule, calm } = this.st
    const cur = this.next
    let target: number
    if (rule === 'buffer') {
      target = BUFFER_STEPS.filter((b) => held >= b).length
      if (calm && target > cur) target = cur + 1
    } else {
      const tp = bits / took
      this.smooth = this.smooth === 0 ? tp : this.smooth * (1 - SMOOTH) + tp * SMOOTH
      const est = calm ? this.smooth * CALM_SAFETY : tp * SAFETY
      target = 0
      RUNGS.forEach((r, i) => {
        if (r.mbps <= est) target = i
      })
      if (calm && target > cur) {
        this.fits++
        target = this.fits >= UP_AFTER && held >= CALM_UP_BUFFER ? cur + 1 : cur
        if (target > cur) this.fits = 0
      } else this.fits = 0
    }
    this.next = target
  }

  private download() {
    const { mode, rung } = this.st
    if (this.downloaded >= CLIP - 1e-9) return
    this.bw = speed(this.st.net, this.time)
    if (mode === 'file') {
      if (this.buffer >= MAX_BUF) return
      const secs = Math.min((this.bw * DT) / RUNGS[rung].mbps, CLIP - this.downloaded)
      this.add(rung, secs)
      return
    }
    if (!this.fetch) {
      if (this.buffer + SEG > MAX_BUF) return
      const r = mode === 'abr' ? this.next : rung
      this.fetch = { rung: r, bits: RUNGS[r].mbps * SEG, got: 0, took: 0 }
    }
    const f = this.fetch
    f.got += this.bw * DT
    f.took += DT
    if (f.got >= f.bits) {
      this.add(f.rung, SEG)
      this.fetch = null
      if (mode === 'abr') this.choose(f.took, f.bits, this.buffer)
    }
  }

  private play() {
    if (this.state === 'start' && this.buffer >= START) {
      this.state = 'playing'
      this.start = this.time
    } else if (this.state === 'frozen' && (this.buffer >= RESUME || (this.downloaded >= CLIP - 1e-9 && this.buffer > 0))) {
      this.state = 'playing'
    }
    if (this.state === 'frozen') this.stalled += DT
    if (this.state !== 'playing') return

    let want = Math.min(DT, CLIP - this.playhead)
    while (want > 1e-9 && this.pieces.length) {
      const p = this.pieces[0]
      if (p.rung !== this.lastShown) {
        if (this.lastShown >= 0) this.switches++
        this.lastShown = p.rung
      }
      const take = Math.min(want, p.secs)
      p.secs -= take
      want -= take
      this.playhead += take
      this.played += take
      this.bitSum += RUNGS[p.rung].mbps * take
      if (p.secs <= 1e-9) this.pieces.shift()
    }
    if (this.playhead >= CLIP - 1e-9) this.state = 'done'
    else if (want > 1e-9) {
      this.state = 'frozen'
      this.stalls++
      this.stalled += want
    }
  }

  step() {
    // The tick keeps counting after the clip ends: the player re-checks a
    // challenge only when it changes, and a goal needs a moment to hold.
    this.tick++
    if (this.state === 'done') return
    for (let i = 0; i < SUBSTEPS && !this.over; i++) {
      this.time += DT
      this.download()
      this.play()
    }
  }

  get metrics(): StreamMetrics {
    return {
      buffer: this.buffer,
      shown: this.pieces[0]?.rung ?? this.lastShown,
      stalls: this.stalls,
      stalled: this.stalled,
      switches: this.switches,
      start: this.start,
      average: this.played > 0 ? this.bitSum / this.played : 0,
      speed: this.bw,
      done: this.state === 'done',
      playing: this.state === 'playing',
      frozen: this.state === 'frozen',
    }
  }
}
