import { FlowSim, type FlowNode, type Job } from '../../core/flow/engine'

// A video site, as a running system. Two kinds of request:
//   an upload: uploader → (limiter) → (queue) → transcoder → video store, one task per segment
//   a play:    viewer → (limiter) → (CDN) → origin → video store
// A transcoder cuts a video into qualities, a segment at a time (or the whole file at once).
// The CDN has a few edges that keep the videos watched most, and may ask one shared cache
// before it asks the origin. Every piece is optional, so a bad design shows how it fails.

export const TICKS_PER_SECOND = 20
export const SECOND = TICKS_PER_SECOND

export const SEG_WORK = 30 // ticks one transcoder needs for one segment, in one quality
export const FILM_SEGS = 12 // segments in a long film
export const QUALITIES = 2 // how much more work several qualities are than one
const SCALE_MAX = 4 // transcoders an autoscaler can add
const SCALE_BACKLOG = 4 // tasks waiting before it starts adding one
const SCALE_AFTER = 2 * SECOND
const BOOT = 3 * SECOND
const SCALE_DOWN = 8 * SECOND
const QUEUE_CAPACITY = 300

const EDGES = 4
const EDGE_CAP = 7 // videos one CDN edge keeps
const SHIELD_CAP = 7
const SHIELD_HOP = 4 // ticks to ask the shared cache and get its answer
const SEEN = 10 * SECOND // a video watched again within this is "watched again soon"
export const POP = 6 // videos most people watch
const POP_SHARE = 0.6
const TAIL = 2000 // every other video
const TAIL_BASE = 100
const PREMIERE = -1
const SLOW = 0.35 // share of viewers on a slow network
const PLAY_WORK = 8 // ticks the origin needs to read a video segment
const PREMIERE_WORK = 20 // a video nobody has watched yet is a big read
const ORIGIN_SLOTS = 8
const ORIGIN_LINE = 24
const STORE_SLOTS = 6
const STORE_LINE = 40
const READ_WORK = 3
const WRITE_WORK = 2
const WRITE_ROOM = 30
const RECENT = 10 * SECOND
const LINK = 4

export interface Phase {
  from: number // tick
  plays: number // per second
  uploads: number // clips per second
  premiere?: number // share of plays that are for the new video nobody has watched yet
}

// A rate limiter standing in front of one lane.
export interface Limit {
  key: string
  lane: 'upload' | 'watch'
  rate: number // requests per second it lets through
}

export interface Config {
  encoders: string[] // keys of the transcoders; the first may crash
  queue?: string
  cdn?: string
  limits: Limit[]
  autoscale: boolean
  chunks: boolean // a long video is cut into segments that run in parallel
  qualities: boolean // every video is made in several qualities
  popularOnly: boolean // the CDN keeps only what is watched again soon
  shield: boolean // an edge asks one shared cache before the origin
  phases: Phase[]
  films: number[] // ticks when a long film is uploaded
  crash?: { at: number; down: number }
  jam?: string[] // parts standing where requests cannot get through
}

export interface Tally {
  uploaded: number // videos sent in
  ready: number // videos ready to watch
  lost: number // videos turned away or dropped
  played: number // plays that finished
  failed: number // plays turned away
  buffered: number // plays that stalled on a slow network
  hits: number // plays a CDN edge answered
  shielded: number // plays the shared cache answered
  limited: number // requests a rate limiter turned away
}

const blank = (): Tally => ({ uploaded: 0, ready: 0, lost: 0, played: 0, failed: 0, buffered: 0, hits: 0, shielded: 0, limited: 0 })

interface Clip {
  tasks: number
  done: number
  at: number
  lost: boolean
  ready: boolean
}

interface Play {
  job: Job
  key: number
  slow: boolean
  edge: number
  admit: boolean // the CDN edge keeps this video once it has it
}

interface Flight {
  id: number // the play fetching it
  admit: boolean
  waiters: Job[]
}

// Tells the system when something was thrown away on its way.
class Net extends FlowSim {
  onLoss?: (job: Job, node: string) => void
  drop(job: Job, node: string) {
    super.drop(job, node)
    this.onLoss?.(job, node)
  }
}

// Takes a few jobs at a time: the origin or the video store.
class Pool implements FlowNode {
  alive = true
  active: Job[] = []
  queue: Job[] = []
  readonly key: string
  private slots: number
  private line: number
  private done: (job: Job, sim: FlowSim) => void
  constructor(key: string, slots: number, line: number, done: (job: Job, sim: FlowSim) => void) {
    this.key = key
    this.slots = slots
    this.line = line
    this.done = done
  }
  receive(job: Job, sim: FlowSim) {
    if (!this.alive || this.queue.length >= this.line) return sim.drop(job, this.key)
    job.remaining = job.work
    this.queue.push(job)
  }
  process(sim: FlowSim) {
    while (this.active.length < this.slots && this.queue.length) this.active.push(this.queue.shift()!)
    const left: Job[] = []
    for (const job of this.active) {
      if (--job.remaining > 0) left.push(job)
      else this.done(job, sim)
    }
    this.active = left
  }
  load() {
    return this.active.length + this.queue.length
  }
  lose() {
    const lost = [...this.active, ...this.queue]
    this.active = []
    this.queue = []
    return lost
  }
}

// The people uploading: they also run the script of the day.
class Uploaders implements FlowNode {
  alive = true
  readonly key = 'uploaders'
  private video: Video
  private due = 0
  constructor(video: Video) {
    this.video = video
  }
  receive() {}
  emit(sim: FlowSim) {
    const v = this.video
    v.script(sim)
    const phase = v.phaseAt(sim.tick)
    if (phase) this.due += phase.uploads / SECOND
    for (; this.due >= 1; this.due--) v.upload(sim, false)
    if (v.cfg.films.includes(sim.tick)) v.upload(sim, true)
  }
}

// The people watching.
class Viewers implements FlowNode {
  alive = true
  readonly key = 'viewers'
  private video: Video
  private due = 0
  constructor(video: Video) {
    this.video = video
  }
  receive() {}
  emit(sim: FlowSim) {
    const phase = this.video.phaseAt(sim.tick)
    if (phase) this.due += phase.plays / SECOND
    for (; this.due >= 1; this.due--) this.video.play(sim)
  }
}

// A part standing where requests cannot get through.
class Jam implements FlowNode {
  alive = true
  readonly key: string
  constructor(key: string) {
    this.key = key
  }
  receive(job: Job, sim: FlowSim) {
    sim.drop(job, this.key)
  }
}

// Lets only so many requests a second through; the rest are turned away.
class Limiter implements FlowNode {
  alive = true
  readonly key: string
  private video: Video
  private lane: 'upload' | 'watch'
  private rate: number
  private tokens: number
  private last = 0
  constructor(limit: Limit, video: Video) {
    this.key = limit.key
    this.lane = limit.lane
    this.rate = limit.rate
    this.tokens = limit.rate
    this.video = video
  }
  receive(job: Job, sim: FlowSim) {
    this.tokens = Math.min(this.rate, this.tokens + ((sim.tick - this.last) * this.rate) / SECOND)
    this.last = sim.tick
    if (this.tokens < 1) {
      this.video.tally.limited++
      return sim.drop(job, this.key)
    }
    this.tokens--
    this.video.pass(job, this.lane, this.key, sim)
  }
}

// Holds upload tasks until a transcoder is free.
class Queue implements FlowNode {
  alive = true
  jobs: Job[] = []
  readonly key: string
  private video: Video
  constructor(key: string, video: Video) {
    this.key = key
    this.video = video
  }
  receive(job: Job, sim: FlowSim) {
    if (this.jobs.length >= QUEUE_CAPACITY) return sim.drop(job, this.key)
    this.jobs.push(job)
  }
  // A task a crashed transcoder was holding goes back to the front.
  requeue(job: Job) {
    this.jobs.unshift(job)
  }
  process(sim: FlowSim) {
    for (const w of this.video.fleet) {
      if (this.jobs.length === 0) break
      if (w.alive && sim.pending(w) === 0) sim.forward(this.jobs.shift()!, this.key, w.key)
    }
  }
  load() {
    return this.jobs.length
  }
}

// A transcoder: one task at a time.
class Encoder implements FlowNode {
  alive: boolean
  active?: Job
  readonly key: string
  readonly spare: boolean // added by the autoscaler, so not drawn on its own
  private video: Video
  constructor(key: string, video: Video, spare: boolean) {
    this.key = key
    this.video = video
    this.spare = spare
    this.alive = !spare
  }
  receive(job: Job, sim: FlowSim) {
    if (!this.alive || this.active) return sim.drop(job, this.key)
    job.remaining = job.work
    this.active = job
  }
  process(sim: FlowSim) {
    if (!this.active) return
    if (--this.active.remaining > 0) return
    const job = this.active
    this.active = undefined
    this.video.segmentDone(job, this.key, sim)
  }
  load() {
    return this.active ? 1 : 0
  }
  lose() {
    const lost = this.active ? [this.active] : []
    this.active = undefined
    return lost
  }
}

// The CDN: edges that keep what was watched, and answer without the origin.
class Cdn implements FlowNode {
  alive = true
  readonly key: string
  private video: Video
  constructor(key: string, video: Video) {
    this.key = key
    this.video = video
  }
  receive(job: Job, sim: FlowSim) {
    this.video.edge(job, this.key, sim)
  }
}

export class Video {
  readonly flow: Net
  readonly cfg: Config
  readonly tally = blank()
  readonly fleet: Encoder[] = []
  readonly origin: Pool
  readonly store: Pool
  queue?: Queue
  private clips = new Map<number, Clip>()
  private plays = new Map<number, Play>()
  private route: Record<'upload' | 'watch', string[]> = { upload: [], watch: [] }
  private edges: Map<number, number>[] = Array.from({ length: EDGES }, () => new Map())
  private edgeSeen: Map<number, number>[] = Array.from({ length: EDGES }, () => new Map())
  private shared = new Map<number, number>()
  private sharedSeen = new Map<number, number>()
  private flights = new Map<number, Flight>()
  private later: { at: number; job: Job }[] = []
  private resend: number[] = []
  private delays: { at: number; delay: number }[] = []
  private nextClip = 0
  private round = 0
  private pressure = 0
  private idle = 0
  private booting: { enc: Encoder; at: number }[] = []
  private reached = 0

  constructor(rng: () => number, cfg: Config) {
    this.cfg = cfg
    const flow = (this.flow = new Net(rng))
    flow.onLoss = (job, node) => this.lose(job, node)
    flow.traffic = () => {
      const phase = this.phaseAt(flow.tick)
      return phase ? phase.plays + phase.uploads : 0
    }
    flow.add(new Uploaders(this))
    flow.add(new Viewers(this))
    for (const l of cfg.limits) {
      flow.add(new Limiter(l, this))
      this.route[l.lane].push(l.key)
    }
    if (cfg.cdn) {
      this.route.watch.push(cfg.cdn)
      flow.add(cfg.jam?.includes(cfg.cdn) ? new Jam(cfg.cdn) : new Cdn(cfg.cdn, this))
    }
    this.origin = flow.add(new Pool('origin', ORIGIN_SLOTS, ORIGIN_LINE, (job, sim) => this.read(job, sim)))
    this.store = flow.add(new Pool('s0', STORE_SLOTS, STORE_LINE, (job, sim) => this.stored(job, sim)))
    flow.link('origin', 's0', 6)
    if (cfg.queue) {
      this.route.upload.push(cfg.queue)
      if (cfg.jam?.includes(cfg.queue)) flow.add(new Jam(cfg.queue))
      else this.queue = flow.add(new Queue(cfg.queue, this))
    }
    const keys = [...cfg.encoders, ...(cfg.autoscale ? Array.from({ length: SCALE_MAX }, (_, i) => `spare-${i + 1}`) : [])]
    for (const key of keys) {
      const enc = flow.add(new Encoder(key, this, key.startsWith('spare-')))
      this.fleet.push(enc)
      flow.link(key, 's0', 6)
    }
    const into = this.route.upload
    for (const enc of this.fleet) flow.link(into.length ? into[into.length - 1] : 'uploaders', enc.key, into.length && cfg.queue === into[into.length - 1] ? 0 : LINK)
    const watch = this.route.watch
    watch.forEach((key, i) => flow.link(i === 0 ? 'viewers' : watch[i - 1], key, LINK))
    flow.link(watch.length ? watch[watch.length - 1] : 'viewers', 'origin', LINK + (cfg.cdn && cfg.shield ? SHIELD_HOP : 0))
    into.forEach((key, i) => {
      if (i > 0) flow.link(into[i - 1], key, LINK)
    })
    if (into.length) flow.link('uploaders', into[0], LINK)
  }

  phaseAt(tick: number) {
    return [...this.cfg.phases].reverse().find((p) => p.from <= tick)
  }

  // --- The day's script ---------------------------------------------------------------

  // Crashes, autoscaling and resent writes, once a tick.
  script(sim: FlowSim) {
    const { crash } = this.cfg
    const first = this.fleet[0]
    if (crash && first && sim.tick === crash.at) {
      first.alive = false
      sim.fail(first.key)
    }
    if (crash && first && sim.tick === crash.at + crash.down) first.alive = true

    if (this.cfg.autoscale) this.scale(sim)

    while (this.resend.length && this.store.load() < WRITE_ROOM) {
      const write = sim.newJob(WRITE_WORK, undefined, 'write')
      write.msg = this.resend.shift()
      sim.forward(write, this.fleet[0].key, 's0')
    }

    this.later = this.later.filter((l) => {
      if (l.at > sim.tick) return true
      this.finish(l.job, sim)
      return false
    })
  }

  private scale(sim: FlowSim) {
    const backlog = this.queue?.load() ?? 0
    const spare = this.fleet.filter((e) => e.spare)
    this.booting = this.booting.filter((b) => {
      if (sim.tick < b.at) return true
      b.enc.alive = true
      return false
    })
    this.pressure = backlog >= SCALE_BACKLOG ? this.pressure + 1 : 0
    if (this.pressure >= SCALE_AFTER) {
      const next = spare.find((e) => !e.alive && !this.booting.some((b) => b.enc === e))
      if (next) this.booting.push({ enc: next, at: sim.tick + BOOT })
      this.pressure = 0
    }
    const idle = backlog === 0 && this.fleet.every((e) => !e.active)
    this.idle = idle ? this.idle + 1 : 0
    if (this.idle >= SCALE_DOWN) {
      const last = [...spare].reverse().find((e) => e.alive)
      if (last) last.alive = false
      this.idle = 0
    }
  }

  // --- Uploads --------------------------------------------------------------------------

  upload(sim: FlowSim, film: boolean) {
    const id = this.nextClip++
    const segs = film ? FILM_SEGS : 1
    const per = SEG_WORK * (this.cfg.qualities ? QUALITIES : 1)
    const tasks = this.cfg.chunks ? segs : 1
    const clip: Clip = { tasks, done: 0, at: sim.tick, lost: false, ready: false }
    this.clips.set(id, clip)
    this.tally.uploaded++
    for (let i = 0; i < tasks; i++) {
      const job = sim.newJob(this.cfg.chunks ? per : per * segs, i, 'upload')
      job.msg = id
      this.pass(job, 'upload', 'uploaders', sim)
    }
  }

  // Send a request on to whatever stands after `from` in its lane.
  pass(job: Job, lane: 'upload' | 'watch', from: string, sim: FlowSim) {
    const route = this.route[lane]
    const next = route[route.indexOf(from) + 1]
    if (next) return sim.forward(job, from, next)
    if (lane === 'watch') return sim.forward(job, from, 'origin')
    const online = this.fleet.filter((e) => e.alive)
    if (!online.length) return sim.drop(job, from)
    sim.forward(job, from, online[this.round++ % online.length].key)
  }

  // A transcoder finished one task of a video.
  segmentDone(job: Job, encoder: string, sim: FlowSim) {
    const clip = this.clips.get(job.msg!)
    if (!clip || clip.lost) return
    if (++clip.done < clip.tasks) return
    const write = sim.newJob(WRITE_WORK, undefined, 'write')
    write.msg = job.msg
    sim.forward(write, encoder, 's0')
  }

  // --- Plays ----------------------------------------------------------------------------

  play(sim: FlowSim) {
    const phase = this.phaseAt(sim.tick)
    const rng = sim.rng
    let key: number
    if (phase?.premiere && rng() < phase.premiere) key = PREMIERE
    else if (rng() < POP_SHARE) key = Math.floor(rng() * POP)
    else key = TAIL_BASE + Math.floor(rng() * TAIL)
    const job = sim.newJob(key === PREMIERE ? PREMIERE_WORK : PLAY_WORK, key, 'play')
    this.plays.set(job.id, { job, key, slow: rng() < SLOW, edge: 0, admit: false })
    this.pass(job, 'watch', 'viewers', sim)
  }

  // Whether a cache should keep a video it just fetched.
  private admits(seen: Map<number, number>, key: number, tick: number) {
    const before = seen.get(key)
    seen.set(key, tick)
    if (!this.cfg.popularOnly) return true
    return before !== undefined && tick - before < SEEN
  }

  private keep(cache: Map<number, number>, key: number, tick: number, cap: number) {
    cache.delete(key)
    cache.set(key, tick)
    if (cache.size > cap) cache.delete(cache.keys().next().value!)
  }

  // A play reaches the CDN: one edge answers, or passes it on.
  edge(job: Job, from: string, sim: FlowSim) {
    const p = this.plays.get(job.id)
    if (!p) return
    this.reached++
    p.edge = Math.floor(sim.rng() * EDGES)
    const cache = this.edges[p.edge]
    if (cache.has(p.key)) {
      this.keep(cache, p.key, sim.tick, EDGE_CAP)
      this.tally.hits++
      return this.finish(job, sim)
    }
    p.admit = this.admits(this.edgeSeen[p.edge], p.key, sim.tick)
    if (!this.cfg.shield) return sim.forward(job, from, 'origin')
    if (this.shared.has(p.key)) {
      this.keep(this.shared, p.key, sim.tick, SHIELD_CAP)
      this.tally.shielded++
      this.later.push({ at: sim.tick + SHIELD_HOP, job })
      return
    }
    const flight = this.flights.get(p.key)
    if (flight) {
      flight.waiters.push(job)
      return
    }
    this.flights.set(p.key, { id: job.id, admit: this.admits(this.sharedSeen, p.key, sim.tick), waiters: [] })
    sim.forward(job, from, 'origin')
  }

  // The origin has a play: read it from the store.
  private read(job: Job, sim: FlowSim) {
    const read = sim.newJob(READ_WORK, undefined, 'read')
    read.msg = job.id
    sim.forward(read, 'origin', 's0')
  }

  // The store finished a write or a read.
  private stored(job: Job, sim: FlowSim) {
    if (job.from === 'write') return this.written(job, sim)
    const p = this.plays.get(job.msg!)
    if (!p) return
    if (p.admit && this.cfg.cdn) this.keep(this.edges[p.edge], p.key, sim.tick, EDGE_CAP)
    const flight = this.flights.get(p.key)
    if (flight && flight.id === job.msg) {
      if (flight.admit) this.keep(this.shared, p.key, sim.tick, SHIELD_CAP)
      this.flights.delete(p.key)
      for (const w of flight.waiters) {
        const q = this.plays.get(w.id)
        if (q?.admit) this.keep(this.edges[q.edge], q.key, sim.tick, EDGE_CAP)
        this.tally.shielded++
        this.finish(w, sim)
      }
    }
    this.finish(p.job, sim)
  }

  private finish(job: Job, sim: FlowSim) {
    const p = this.plays.get(job.id)
    if (!p) return
    this.plays.delete(job.id)
    this.tally.played++
    if (p.slow && !this.cfg.qualities) this.tally.buffered++
    sim.complete(job)
  }

  private written(job: Job, sim: FlowSim) {
    const clip = this.clips.get(job.msg!)
    if (!clip || clip.lost || clip.ready) return
    clip.ready = true
    this.tally.ready++
    this.delays.push({ at: sim.tick, delay: sim.tick - clip.at })
  }

  // Something was thrown away on its way.
  private lose(job: Job, node: string) {
    if (job.from === 'write') {
      if (this.clips.has(job.msg!)) this.resend.push(job.msg!)
    } else if (job.from === 'upload') {
      const clip = this.clips.get(job.msg!)
      if (!clip || clip.lost) return
      // With a queue, a task a crashed transcoder held goes back in line.
      if (this.queue && this.fleet.some((e) => e.key === node)) return this.queue.requeue(job)
      clip.lost = true
      this.tally.lost++
    } else if (job.from === 'play' || job.from === 'read') {
      const id = job.from === 'play' ? job.id : job.msg!
      const p = this.plays.get(id)
      if (!p) return
      this.plays.delete(id)
      this.tally.failed++
      const flight = this.flights.get(p.key)
      if (flight && flight.id === id) {
        this.flights.delete(p.key)
        for (const w of flight.waiters) {
          if (this.plays.delete(w.id)) this.tally.failed++
        }
      }
    }
  }

  // --- What the checks read -----------------------------------------------------

  // Seconds an average play took to start, over the last few hundred.
  wait() {
    return this.flow.avgLatency() / SECOND
  }

  // Share of plays that stalled.
  buffering() {
    return this.tally.played === 0 ? 0 : this.tally.buffered / this.tally.played
  }

  // Seconds the slowest upload of the last 10 seconds took to be ready, or has been waiting so far.
  slowest() {
    const t = this.flow.tick
    const done = this.delays.filter((d) => t - d.at < RECENT).map((d) => d.delay)
    const waiting = [...this.clips.values()].filter((c) => !c.ready && !c.lost).map((c) => t - c.at)
    return Math.max(0, ...done, ...waiting) / SECOND
  }

  // Tasks waiting for a transcoder.
  backlog() {
    return (this.queue?.load() ?? 0) + this.fleet.reduce((n, e) => n + e.load(), 0)
  }

  // Transcoders running right now.
  running() {
    return this.fleet.filter((e) => e.alive).length
  }

  // Share of the origin's slots that are taken, 0 to 1.
  originLoad() {
    return this.origin.load() / (ORIGIN_SLOTS + ORIGIN_LINE)
  }

  // Share of plays the CDN answered itself, 0 to 1.
  hitRatio() {
    return this.reached === 0 ? 0 : (this.tally.hits + this.tally.shielded) / this.reached
  }

  storeLoad() {
    return this.store.load() / STORE_LINE
  }
}
