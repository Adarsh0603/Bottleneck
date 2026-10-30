import { FlowSim, type FlowNode, type Job } from '../../core/flow/engine'
import { SECOND, TICKS_PER_SECOND } from '../../core/flow/time'
import { Jam, Limiter, Net, Pool, Queue } from '../../core/flow/parts'

// A video site at YouTube's size, as a running system. Two kinds of request:
//   an upload: uploaders → (limiter) → (queue) → transcoder → a store shard, one task per segment
//   a play:    viewers → (limiter) → CDN edge → origin → a store shard
// A video is cut into segments, and every segment is made in several qualities (rungs). The
// learner places every machine: transcoders on the uploaders' side, origins on the viewers'
// side, CDN edges, and the shards of the video store. Old videos sit in cold storage, which
// is slow to read, until something reads them.

export { SECOND, TICKS_PER_SECOND }

export const CLIP_SECONDS = 24 // an ordinary upload, in seconds of video
export const FILM_SECONDS = 240 // a long 4K film
export const RUNG_WORK = 0.8 // ticks one transcoder needs for one second of video in one quality
export const TASK_COST = 2 // ticks of set-up every task costs, however short
const SCALE_MAX = 3 // transcoders an autoscaler can add
const SCALE_BACKLOG = 4 // tasks waiting before it starts adding one
const SCALE_AFTER = 1 * SECOND
const BOOT = 2 * SECOND
const SCALE_DOWN = 14 * SECOND
const QUEUE_CAPACITY = 400

export const EDGE_SLOTS = 8
export const EDGE_WORK = 3 // ticks an edge needs to answer a play
export const ORIGIN_SLOTS = 6
export const ORIGIN_LINE = 24
export const MISS_WORK = 48 // ticks an origin needs to answer a miss, divided by the segment length in seconds
export const SHARD_SLOTS = 4
export const SHARD_LINE = 36
export const READ_WORK = 12 // ticks a shard needs to read a hot video
export const COLD_WORK = 40 // ... and a cold one
export const VIRAL_WORK = 30 // a video nobody has watched yet is a big read
const WRITE_ROOM = 30
const SHIELD_CAP = 8 // videos the shared cache keeps
const SHIELD_HOP = 4 // ticks to ask the shared cache and get its answer
export const POP = 40 // videos most people watch
const POP_SHARE = 0.65
const TAIL = 2000 // every other video
const TAIL_BASE = 100
export const OLD_BASE = 5000
export const OLD_N = 24 // old videos that suddenly trend
const WARM_FOR = 1 * SECOND // a cold video that was read stays warm this long
const VIRAL = -1
const SLOW = 0.35 // share of viewers on a slow network
export const MIN_RUNGS = 3 // fewer qualities and a slow network has nothing it can play
export const MAX_SEGMENT = 8 // longer segments and a slow network runs dry before the next arrives
const START_DELAY = 1.5 // ticks a play waits for its first segment, per second of segment
const RECENT = 10 * SECOND
const LINK = 4

export interface Phase {
  from: number // tick
  plays: number // per second
  uploads: number // clips per second
  viral?: number // share of plays for the new video nobody has watched yet
  trend?: number // share of plays for old videos that trend
}

// A rate limiter standing in front of one lane.
export interface Limit {
  key: string
  lane: 'upload' | 'watch'
  rate: number // requests per second it lets through
}

export interface Config {
  encoders: string[] // keys of the transcoders; the first may crash
  origins: string[]
  edges: string[]
  shards: string[]
  queue?: string
  limits: Limit[]
  autoscale: boolean
  rungs: number // qualities of every video
  segment: number // seconds of video in a segment
  keep: number // videos an edge keeps
  shield: boolean // an edge asks one shared cache before the origin
  phases: Phase[]
  films: number[] // ticks when a long film is uploaded
  crash?: { at: number; down: number }
  jam?: string[] // parts standing where requests cannot get through
}

export interface Tally {
  uploaded: number
  ready: number
  lost: number
  played: number
  failed: number
  buffered: number
  hits: number
  shielded: number
  limited: number
  cold: number // reads that went to cold storage
}

const blank = (): Tally => ({ uploaded: 0, ready: 0, lost: 0, played: 0, failed: 0, buffered: 0, hits: 0, shielded: 0, limited: 0, cold: 0 })

interface Clip {
  tasks: number
  done: number
  at: number
  segs: number
  lost: boolean
  ready: boolean
}

interface Play {
  job: Job
  key: number
  slow: boolean
  edge: string
}

interface Flight {
  id: number
  waiters: Job[]
}

// The people uploading: they also run the script of the day.
class Uploaders implements FlowNode {
  alive = true
  readonly key = 'uploaders'
  private site: Youtube
  private due = 0
  constructor(site: Youtube) {
    this.site = site
  }
  receive() {}
  emit(sim: FlowSim) {
    const v = this.site
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
  private site: Youtube
  private due = 0
  constructor(site: Youtube) {
    this.site = site
  }
  receive() {}
  emit(sim: FlowSim) {
    const phase = this.site.phaseAt(sim.tick)
    if (phase) this.due += phase.plays / SECOND
    for (; this.due >= 1; this.due--) this.site.play(sim)
  }
}

// A transcoder: one task at a time.
class Encoder implements FlowNode {
  alive: boolean
  active?: Job
  readonly key: string
  readonly spare: boolean // added by the autoscaler, so not drawn on its own
  private site: Youtube
  constructor(key: string, site: Youtube, spare: boolean) {
    this.key = key
    this.site = site
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
    this.site.taskDone(job, this.key, sim)
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

// Work that comes in over a lane and goes round the machines of one kind.
export class Youtube {
  readonly flow: Net
  readonly cfg: Config
  readonly tally = blank()
  readonly fleet: Encoder[] = []
  readonly origins: Pool[] = []
  readonly edgePools: Pool[] = []
  readonly shards: Pool[] = []
  queue?: Queue
  private clips = new Map<number, Clip>()
  private plays = new Map<number, Play>()
  private route: Record<'upload' | 'watch', string[]> = { upload: [], watch: [] }
  private cache = new Map<string, Map<number, number>>()
  private shared = new Map<number, number>()
  private flights = new Map<number, Flight>()
  private warm = new Map<number, number>()
  private later: { at: number; job: Job; done: boolean }[] = []
  private resend: number[] = []
  private delays: { at: number; delay: number }[] = []
  private nextClip = 0
  private round = 0
  private originRound = 0
  private pressure = 0
  private idle = 0
  private booting: { enc: Encoder; at: number }[] = []
  private reached = 0
  private missWork: number

  constructor(rng: () => number, cfg: Config) {
    this.cfg = cfg
    this.missWork = Math.max(2, Math.round(MISS_WORK / cfg.segment))
    const flow = (this.flow = new Net(rng))
    flow.onLoss = (job, node) => this.lose(job, node)
    flow.traffic = () => {
      const phase = this.phaseAt(flow.tick)
      return phase ? phase.plays + phase.uploads : 0
    }
    flow.add(new Uploaders(this))
    flow.add(new Viewers(this))
    for (const l of cfg.limits) {
      flow.add(new Limiter(l.key, l.rate, () => this.tally.limited++, (job, sim) => this.pass(job, l.lane, l.key, sim)))
      this.route[l.lane].push(l.key)
    }
    cfg.shards.forEach((key) => {
      const pool = flow.add(new Pool(key, SHARD_SLOTS, SHARD_LINE, (job, sim) => this.stored(job, sim)))
      this.shards.push(pool)
    })
    cfg.origins.forEach((key) => {
      const pool = flow.add(new Pool(key, ORIGIN_SLOTS, ORIGIN_LINE, (job, sim) => this.read(job, key, sim)))
      this.origins.push(pool)
      for (const s of cfg.shards) flow.link(key, s, 6)
    })
    cfg.edges.forEach((key) => {
      // The day starts with the popular videos already on the edges.
      this.cache.set(key, new Map(Array.from({ length: Math.min(POP, cfg.keep) }, (_, i) => [i, 0] as [number, number])))
      if (cfg.jam?.includes(key)) return void flow.add(new Jam(key))
      const pool = flow.add(new Pool(key, EDGE_SLOTS, 12, (job, sim) => this.edge(job, key, sim)))
      this.edgePools.push(pool)
      for (const o of cfg.origins) flow.link(key, o, LINK + (cfg.shield ? SHIELD_HOP : 0))
    })
    if (cfg.queue) {
      this.route.upload.push(cfg.queue)
      if (cfg.jam?.includes(cfg.queue)) flow.add(new Jam(cfg.queue))
      else this.queue = flow.add(new Queue(cfg.queue, QUEUE_CAPACITY, () => this.fleet))
    }
    const keys = [...cfg.encoders, ...(cfg.autoscale ? Array.from({ length: SCALE_MAX }, (_, i) => `spare-${i + 1}`) : [])]
    for (const key of keys) {
      const enc = flow.add(new Encoder(key, this, key.startsWith('spare-')))
      this.fleet.push(enc)
      for (const s of cfg.shards) flow.link(key, s, 6)
    }
    const into = this.route.upload
    const last = into.length ? into[into.length - 1] : 'uploaders'
    for (const enc of this.fleet) flow.link(last, enc.key, cfg.queue === last ? 0 : LINK)
    into.forEach((key, i) => flow.link(i === 0 ? 'uploaders' : into[i - 1], key, LINK))
    const watch = this.route.watch
    const first = watch[0]
    const lastWatch = watch.length ? watch[watch.length - 1] : 'viewers'
    if (first) flow.link('viewers', first, LINK)
    watch.forEach((key, i) => i > 0 && flow.link(watch[i - 1], key, LINK))
    for (const e of cfg.edges) flow.link(lastWatch, e, LINK)
    for (const o of cfg.origins) flow.link(lastWatch, o, LINK)
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

    while (this.resend.length && this.shards.length && this.shards.every((s) => s.load() < WRITE_ROOM)) {
      const id = this.resend.shift()!
      const clip = this.clips.get(id)
      if (!clip) continue
      const write = sim.newJob(this.writeWork(clip), undefined, 'write')
      write.msg = id
      sim.forward(write, this.fleet[0]?.key ?? 'uploaders', this.shardFor(id).key)
    }

    this.later = this.later.filter((l) => {
      if (l.at > sim.tick) return true
      if (l.done) this.complete(l.job, sim)
      else this.finish(l.job, sim)
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

  private shardFor(key: number) {
    return this.shards[Math.abs(key) % this.shards.length]
  }

  private writeWork(clip: Clip) {
    return Math.ceil((clip.segs * this.cfg.rungs) / 4) + 1
  }

  // --- Uploads --------------------------------------------------------------------------

  upload(sim: FlowSim, film: boolean) {
    const id = this.nextClip++
    const { segment, rungs } = this.cfg
    const tasks = Math.ceil((film ? FILM_SECONDS : CLIP_SECONDS) / segment)
    const clip: Clip = { tasks, done: 0, at: sim.tick, segs: tasks, lost: false, ready: false }
    this.clips.set(id, clip)
    this.tally.uploaded++
    const work = Math.ceil(segment * rungs * RUNG_WORK) + TASK_COST
    for (let i = 0; i < tasks; i++) {
      const job = sim.newJob(work, i, 'upload')
      job.msg = id
      this.pass(job, 'upload', 'uploaders', sim)
    }
  }

  // Send a request on to whatever stands after `from` in its lane.
  pass(job: Job, lane: 'upload' | 'watch', from: string, sim: FlowSim) {
    const route = this.route[lane]
    const next = route[route.indexOf(from) + 1]
    if (next) return sim.forward(job, from, next)
    if (lane === 'watch') {
      if (this.cfg.edges.length) {
        const key = this.cfg.edges[Math.floor(sim.rng() * this.cfg.edges.length)]
        const p = this.plays.get(job.id)
        if (p) p.edge = key
        return sim.forward(job, from, key)
      }
      return this.toOrigin(job, from, sim)
    }
    const online = this.fleet.filter((e) => e.alive)
    if (!online.length) return sim.drop(job, from)
    sim.forward(job, from, online[this.round++ % online.length].key)
  }

  // One task of a video is made.
  taskDone(job: Job, encoder: string, sim: FlowSim) {
    const clip = this.clips.get(job.msg!)
    if (!clip || clip.lost) return
    if (++clip.done < clip.tasks) return
    if (!this.shards.length) return
    const write = sim.newJob(this.writeWork(clip), undefined, 'write')
    write.msg = job.msg
    sim.forward(write, encoder, this.shardFor(job.msg!).key)
  }

  // --- Plays ----------------------------------------------------------------------------

  play(sim: FlowSim) {
    const phase = this.phaseAt(sim.tick)
    const rng = sim.rng
    let key: number
    if (phase?.viral && rng() < phase.viral) key = VIRAL
    else if (phase?.trend && rng() < phase.trend) key = OLD_BASE + Math.floor(rng() * OLD_N)
    else if (rng() < POP_SHARE) key = Math.floor(rng() * POP)
    else key = TAIL_BASE + Math.floor(rng() * TAIL)
    const job = sim.newJob(EDGE_WORK, key, 'play')
    this.plays.set(job.id, { job, key, slow: rng() < SLOW, edge: '' })
    this.pass(job, 'watch', 'viewers', sim)
  }

  private keep(cache: Map<number, number>, key: number, tick: number, cap: number) {
    cache.delete(key)
    cache.set(key, tick)
    if (cache.size > cap) cache.delete(cache.keys().next().value!)
  }

  private toOrigin(job: Job, from: string, sim: FlowSim) {
    const online = this.origins.filter((o) => o.alive)
    if (!online.length) return sim.drop(job, from)
    job.work = this.missWork
    sim.forward(job, from, online[this.originRound++ % online.length].key)
  }

  // A play reaches an edge: it answers, or passes it on.
  private edge(job: Job, key: string, sim: FlowSim) {
    const p = this.plays.get(job.id)
    if (!p) return
    this.reached++
    p.edge = key
    const cache = this.cache.get(key)!
    if (cache.has(p.key)) {
      this.keep(cache, p.key, sim.tick, this.cfg.keep)
      this.tally.hits++
      return this.finish(job, sim)
    }
    if (!this.cfg.shield) return this.toOrigin(job, key, sim)
    if (this.shared.has(p.key)) {
      this.keep(this.shared, p.key, sim.tick, SHIELD_CAP)
      this.tally.shielded++
      this.keep(cache, p.key, sim.tick, this.cfg.keep)
      this.later.push({ at: sim.tick + SHIELD_HOP, job, done: false })
      return
    }
    const flight = this.flights.get(p.key)
    if (flight) {
      flight.waiters.push(job)
      return
    }
    this.flights.set(p.key, { id: job.id, waiters: [] })
    this.toOrigin(job, key, sim)
  }

  // An origin has a play: read it from the store.
  private read(job: Job, origin: string, sim: FlowSim) {
    const p = this.plays.get(job.id)
    if (!p) return
    if (!this.shards.length) return sim.drop(job, origin)
    const old = p.key >= OLD_BASE
    const cold = old && !(this.warm.has(p.key) && sim.tick - this.warm.get(p.key)! < WARM_FOR)
    const read = sim.newJob(p.key === VIRAL ? VIRAL_WORK : cold ? COLD_WORK : READ_WORK, p.key, 'read')
    read.msg = job.id
    read.via = cold ? 'cold' : undefined
    sim.forward(read, origin, this.shardFor(p.key).key)
  }

  // A shard finished a write or a read.
  private stored(job: Job, sim: FlowSim) {
    if (job.from === 'write') return this.written(job, sim)
    const p = this.plays.get(job.msg!)
    if (!p) return
    if (job.via === 'cold') this.tally.cold++
    if (p.key >= OLD_BASE) this.warm.set(p.key, sim.tick)
    if (this.cfg.edges.includes(p.edge)) this.keep(this.cache.get(p.edge)!, p.key, sim.tick, this.cfg.keep)
    const flight = this.flights.get(p.key)
    if (flight && flight.id === job.msg) {
      this.keep(this.shared, p.key, sim.tick, SHIELD_CAP)
      this.flights.delete(p.key)
      for (const w of flight.waiters) {
        const q = this.plays.get(w.id)
        if (q && this.cfg.edges.includes(q.edge)) this.keep(this.cache.get(q.edge)!, q.key, sim.tick, this.cfg.keep)
        this.tally.shielded++
        this.finish(w, sim)
      }
    }
    this.finish(p.job, sim)
  }

  // The play is served; it still waits for its first segment to arrive.
  private finish(job: Job, sim: FlowSim) {
    if (!this.plays.has(job.id)) return
    const wait = Math.round(this.cfg.segment * START_DELAY)
    if (wait <= 0) return this.complete(job, sim)
    this.later.push({ at: sim.tick + wait, job, done: true })
  }

  private complete(job: Job, sim: FlowSim) {
    const p = this.plays.get(job.id)
    if (!p) return
    this.plays.delete(job.id)
    this.tally.played++
    if (p.slow && (this.cfg.rungs < MIN_RUNGS || this.cfg.segment > MAX_SEGMENT)) this.tally.buffered++
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

  // Share of the origins' slots that are taken, 0 to 1.
  originLoad() {
    if (!this.origins.length) return 0
    return Math.max(...this.origins.map((o) => o.load() / (ORIGIN_SLOTS + ORIGIN_LINE)))
  }

  // Share of plays the CDN answered itself, 0 to 1.
  hitRatio() {
    return this.reached === 0 ? 0 : (this.tally.hits + this.tally.shielded) / this.reached
  }

  // The busiest shard, 0 to 1.
  storeLoad() {
    if (!this.shards.length) return 0
    return Math.max(...this.shards.map((s) => s.load() / SHARD_LINE))
  }

  // Videos held by an edge.
  held(key: string) {
    return this.cache.get(key)?.size ?? 0
  }
}
