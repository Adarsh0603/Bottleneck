// Pub/sub and streams, on the shared flow engine. An order service publishes
// "order placed" events. Three teams want every one of them:
//
//   orders ──▶ channel ──▶ Email      (slow: about 2 events a second per consumer)
//                     ├──▶ Analytics  (fast, but goes offline now and then)
//                     └──▶ Inventory  (needs the events for one product in order)
//
// What the channel is decides what happens:
//   - queue:  each event goes to ONE consumer, whichever team it belongs to.
//             The other teams never see it.
//   - topic:  each event is copied to every team at once. A team that is
//             offline, or too slow to take it, misses it for good.
//   - stream: each event is appended to a log and kept for a while. Every team
//             reads it at its own pace and keeps its own place (offset), so a
//             slow or offline team catches up later. The log has partitions;
//             inside a team each partition is read by one consumer at a time,
//             so more consumers than partitions do nothing.

import { FlowSim, type FlowNode, type Job } from '../../core/flow/engine'
import { Log, Reader } from '../../core/flow/log'
import { Source, Worker } from '../../core/flow/nodes'
import { TICKS_PER_SECOND } from '../../core/flow/time'

export type Team = 'email' | 'stats' | 'stock'
export const TEAMS: Team[] = ['email', 'stats', 'stock']
export const TEAM_NAMES: Record<Team, string> = { email: 'Email', stats: 'Analytics', stock: 'Inventory' }
export const MAX_CONSUMERS: Record<Team, number> = { email: 4, stats: 1, stock: 4 }

export type Mode = 'queue' | 'topic' | 'stream'
export type KeyBy = 'none' | 'order' | 'product'
export type Commit = 'before' | 'after'

export { TICKS_PER_SECOND }
export const PRODUCTS = 3
export const MAX_PARTITIONS = 4

const WORK: Record<Team, number> = { email: 9, stock: 8, stats: 4 } // ticks per event
const SLOTS: Record<Team, number> = { email: 1, stock: 1, stats: 2 }
const JITTER: Record<Team, number> = { email: 2, stock: 4, stats: 1 } // work varies by this much, up or down
const TOPIC_WAIT = 3 // events a consumer lets wait when it is handed them directly
const QUEUE_CAPACITY = 60
const PREFETCH = 1 // events a queue hands a consumer beyond its free slots
const STREAM_PREFETCH = 3 // events a stream consumer fetches ahead of its work
const COMMIT_TICKS = 6 // how long a consumer takes to tell the log “done”
const CRASH_TICKS = 24
const CRASH_EVERY = 5 * TICKS_PER_SECOND
const WINDOW = 3 * TICKS_PER_SECOND
export const LINK_TICKS = { ordersChannel: 8, channelConsumer: 6 }

export interface Outage {
  start: number // tick
  length: number // ticks
  every?: number // repeat after this many ticks
}

export interface Config {
  rps: number
  mode: Mode
  present: Record<Team, boolean> // which teams want the events
  counts: Record<Team, number> // consumers switched on
  partitions: number
  key: KeyBy
  retention: number // seconds
  commit: Commit
  dedupe: boolean
  outage: Outage | null // Analytics goes offline
  crashy: boolean // Inventory's consumers crash now and then
}

export const DEFAULTS: Config = {
  rps: 2,
  mode: 'queue',
  present: { email: true, stats: true, stock: true },
  counts: { email: 1, stats: 1, stock: 1 },
  partitions: 1,
  key: 'none',
  retention: 30,
  commit: 'after',
  dedupe: false,
  outage: null,
  crashy: false,
}

interface Meta {
  seq: number
  product: number
  team: Team
  work: number
  partition?: number
  offset?: number
}

interface Tally {
  published: number
  processed: Record<Team, number>
  lost: Record<Team, number>
  duplicates: number
  ignored: number
  disorder: number
  outages: number
  crashes: number
  done: Record<Team, Set<number>>
  last: Map<number, number>
}

const emptyTally = (): Tally => ({
  published: 0,
  processed: { email: 0, stats: 0, stock: 0 },
  lost: { email: 0, stats: 0, stock: 0 },
  duplicates: 0,
  ignored: 0,
  disorder: 0,
  outages: 0,
  crashes: 0,
  done: { email: new Set(), stats: new Set(), stock: new Set() },
  last: new Map(),
})

// Users placing orders at a steady rate, each about one of a few products.
class Orders extends Source {
  constructor() {
    super('orders')
    this.minWork = this.maxWork = 1
    this.keyOf = (rng) => Math.floor(rng() * PRODUCTS)
  }
}

// A team's consumer: takes events one at a time.
export class Consumer extends Worker {
  on = true
  downUntil = 0 // crashed until this tick
  readonly team: Team
  readonly index: number
  private bus: Bus

  constructor(team: Team, index: number, bus: Bus) {
    super(`${team}-${index}`, { slots: SLOTS[team], queueLimit: TOPIC_WAIT, workPerRequest: WORK[team] })
    this.team = team
    this.index = index
    this.bus = bus
    this.workOf = (job) => bus.meta.get(job)?.work ?? WORK[team]
    this.onFinish = (job) => bus.finished(team, job)
  }

  receive(job: Job, sim: FlowSim) {
    // A stream consumer asks for what it can take, so it is never over-full.
    // If it went down it still holds what it had already asked for.
    const stream = this.bus.cfg.mode === 'stream'
    if (!stream && (!this.alive || this.queue.length >= this.queueLimit)) {
      this.bus.lost(this.team)
      return sim.drop(job, this.key)
    }
    job.remaining = this.workOf!(job)
    this.queue.push(job)
  }
}

export const jitter = (team: Team, rng: () => number) => WORK[team] - JITTER[team] + Math.floor(rng() * (2 * JITTER[team] + 1))

// The channel in the middle: a queue, a topic or a stream, depending on mode.
class Channel implements FlowNode {
  alive = true
  readonly key = 'channel'
  readonly jobs: Job[] = [] // waiting, in queue mode
  readonly capacity = QUEUE_CAPACITY
  private bus: Bus
  private turn = 0

  constructor(bus: Bus) {
    this.bus = bus
  }

  get log() {
    return this.bus.log
  }

  receive(job: Job, sim: FlowSim) {
    const { cfg, tally } = this.bus
    tally.published++
    const product = job.key ?? 0
    if (cfg.mode === 'queue') {
      if (this.jobs.length >= this.capacity) return sim.drop(job, this.key)
      this.jobs.push(job)
    } else if (cfg.mode === 'topic') {
      for (const team of TEAMS) {
        if (!cfg.present[team]) continue
        const live = this.bus.live(team)
        if (live.length === 0) {
          this.bus.lost(team, true)
          continue
        }
        const to = live.reduce((best, c) => (sim.pending(c) < sim.pending(best) ? c : best), live[this.turn++ % live.length])
        sim.forward(this.bus.copy(team, job.id, product), this.key, to.key)
      }
    } else {
      const lane = this.bus.laneOf(job.id, product)
      this.bus.log.append(lane, { seq: job.id, product, at: sim.tick })
    }
  }

  process(sim: FlowSim) {
    const { cfg, log, readers } = this.bus
    if (cfg.mode === 'queue') return this.drainQueue(sim)
    if (cfg.mode !== 'stream') return
    log.trim(sim.tick)
    for (const team of TEAMS) {
      if (!cfg.present[team]) continue
      const reader = readers[team]
      for (let p = 0; p < log.partitions; p++) {
        if (reader.cursor[p] < log.base[p]) {
          // The log threw these away before this team came for them.
          for (let k = reader.cursor[p]; k < log.base[p]; k++) this.bus.lost(team, true)
          reader.cursor[p] = log.base[p]
          reader.committed[p] = Math.max(reader.committed[p], log.base[p])
        }
      }
      const live = this.bus.live(team)
      if (live.length === 0) continue
      for (let p = 0; p < log.partitions; p++) {
        const consumer = live[p % live.length]
        while (reader.cursor[p] < log.end(p) && sim.pending(consumer) < consumer.slots + STREAM_PREFETCH) {
          const offset = reader.cursor[p]++
          const entry = log.at(p, offset)!
          if (cfg.commit === 'before') reader.committed[p] = reader.cursor[p]
          const job = this.bus.copy(team, entry.seq, entry.product, p, offset)
          sim.forward(job, this.key, consumer.key)
        }
      }
    }
  }

  // A queue hands each event to one consumer that has room, whatever its team.
  private drainQueue(sim: FlowSim) {
    const { cfg } = this.bus
    while (this.jobs.length > 0) {
      const free = this.bus.consumers.filter((c) => c.on && c.alive && sim.pending(c) < c.slots + PREFETCH)
      if (free.length === 0) break
      const best = free.reduce((a, c) => (sim.pending(c) < sim.pending(a) ? c : a), free[this.turn++ % free.length])
      const job = this.jobs.shift()!
      this.bus.meta.set(job, { seq: job.id, product: job.key ?? 0, team: best.team, work: jitter(best.team, sim.rng) })
      for (const team of TEAMS) if (cfg.present[team] && team !== best.team) this.bus.lost(team, true)
      sim.forward(job, this.key, best.key)
    }
  }

  load() {
    return this.jobs.length
  }
}

// Does the things that happen on a schedule: outages, crashes, and commits.
class Clock implements FlowNode {
  alive = true
  readonly key = 'clock'
  private bus: Bus

  constructor(bus: Bus) {
    this.bus = bus
  }

  receive() {}

  process(sim: FlowSim) {
    this.bus.tickClock(sim)
  }
}

export class Bus {
  readonly flow: FlowSim
  readonly cfg: Config
  readonly consumers: Consumer[] = []
  readonly meta = new WeakMap<Job, Meta>()
  readonly orders: Source
  readonly channel?: Channel
  log: Log
  readers: Record<Team, Reader>
  tally = emptyTally()
  private pending: { team: Team; partition: number; offset: number; at: number }[] = []
  private nextCrash = CRASH_EVERY
  private signature = ''
  private lastMode: Mode = DEFAULTS.mode
  private history: { processed: number; dropped: number; completed: number }[] = []
  // With `keys`, only those consumers exist, and they are always on (a build
  // places them itself). Otherwise every consumer exists and `counts` picks.
  private manual: boolean

  constructor(rng: () => number = Math.random, opts: { keys?: string[]; channel?: boolean } = {}) {
    this.flow = new FlowSim(rng)
    this.cfg = { ...DEFAULTS, present: { ...DEFAULTS.present }, counts: { ...DEFAULTS.counts } }
    this.manual = !!opts.keys
    this.log = new Log(1, this.cfg.retention * TICKS_PER_SECOND)
    this.readers = this.newReaders()
    this.orders = this.flow.add(new Orders())
    if (opts.channel !== false) {
      this.channel = this.flow.add(new Channel(this))
      this.flow.link('orders', 'channel', LINK_TICKS.ordersChannel)
    }
    for (const team of TEAMS) {
      for (let i = 0; i < MAX_CONSUMERS[team]; i++) {
        const key = `${team}-${i}`
        if (opts.keys && !opts.keys.includes(key)) continue
        const c = this.flow.add(new Consumer(team, i, this))
        this.consumers.push(c)
        if (this.channel) this.flow.link('channel', key, LINK_TICKS.channelConsumer)
      }
    }
    this.flow.add(new Clock(this))
    this.configure({})
  }

  private newReaders() {
    const n = this.log.partitions
    return { email: new Reader(n), stats: new Reader(n), stock: new Reader(n) }
  }

  // Consumers of a team that are switched on and up, in order.
  live(team: Team) {
    return this.consumers.filter((c) => c.team === team && c.on && c.alive)
  }

  laneOf(seq: number, product: number) {
    const n = this.log.partitions
    if (this.cfg.key === 'product') return product % n
    if (this.cfg.key === 'order') return ((seq * 2654435761) >>> 0) % n
    return seq % n
  }

  copy(team: Team, seq: number, product: number, partition?: number, offset?: number): Job {
    const work = jitter(team, this.flow.rng)
    const job = this.flow.newJob(work, product, 'orders')
    this.meta.set(job, { seq, product, team, work, partition, offset })
    return job
  }

  // A team did not get an event. With `show`, a red cube tumbles at its first
  // consumer (when the event itself was never sent there to be dropped).
  lost(team: Team, show = false) {
    this.tally.lost[team]++
    if (!show) return
    const at = this.consumers.find((c) => c.team === team)
    if (at) this.flow.drop(this.flow.newJob(1, undefined, 'orders'), at.key)
  }

  finished(team: Team, job: Job) {
    const m = this.meta.get(job)
    if (!m) return
    const { tally } = this
    tally.processed[team]++
    const repeat = tally.done[team].has(m.seq)
    if (repeat) {
      if (this.cfg.dedupe) tally.ignored++
      else tally.duplicates++
    } else {
      tally.done[team].add(m.seq)
      if (team === 'stock') {
        const last = tally.last.get(m.product)
        if (last !== undefined && m.seq < last) tally.disorder++
        else tally.last.set(m.product, m.seq)
      }
    }
    if (this.cfg.mode === 'stream' && this.cfg.commit === 'after' && m.partition !== undefined) {
      this.pending.push({ team, partition: m.partition, offset: m.offset!, at: this.flow.tick + COMMIT_TICKS })
    }
  }

  tickClock(sim: FlowSim) {
    const { cfg, tick } = { cfg: this.cfg, tick: sim.tick }

    const o = cfg.outage
    const down = !!o && tick >= o.start && (o.every ? (tick - o.start) % o.every : tick - o.start) < o.length
    for (const c of this.consumers) {
      const up = !(c.team === 'stats' && down) && tick >= c.downUntil
      if (up === c.alive) continue
      c.alive = up
      if (up && c.team === 'stats' && c.index === 0) this.tally.outages++
    }

    for (const done of this.pending.filter((p) => p.at <= tick)) {
      const r = this.readers[done.team]
      r.committed[done.partition] = Math.max(r.committed[done.partition], done.offset + 1)
    }
    this.pending = this.pending.filter((p) => p.at > tick)

    if (cfg.crashy && tick >= this.nextCrash) {
      const target = this.live('stock').find((c) => c.active.length > 0)
      const ready = cfg.commit === 'before' || this.pending.some((p) => p.team === 'stock') || tick >= this.nextCrash + 2 * TICKS_PER_SECOND
      if (target && ready) this.crash(target, sim)
    }
  }

  private crash(c: Consumer, sim: FlowSim) {
    const held = c.lose()
    const flying = sim.inTransit.filter((t) => t.to === c.key)
    sim.inTransit = sim.inTransit.filter((t) => t.to !== c.key)
    const redelivered = this.cfg.mode === 'stream' && this.cfg.commit === 'after'
    if (!redelivered) for (let i = 0; i < held.length + flying.length; i++) this.lost(c.team, true)
    this.readers[c.team].rewind()
    this.pending = this.pending.filter((p) => p.team !== c.team)
    c.alive = false
    c.downUntil = sim.tick + CRASH_TICKS
    this.tally.crashes++
    this.nextCrash = sim.tick + CRASH_EVERY
  }

  reset() {
    this.tally = emptyTally()
    this.pending = []
    this.nextCrash = this.flow.tick + CRASH_EVERY
  }

  // Change the setup. Counting starts again whenever it changes in a way that
  // changes the outcome, so the numbers always describe the current setup.
  configure(next: Partial<Config>) {
    const { cfg } = this
    Object.assign(cfg, next)
    this.orders.rate = cfg.rps / TICKS_PER_SECOND
    for (const c of this.consumers) c.on = this.manual || c.index < cfg.counts[c.team]

    if (this.log.partitions !== cfg.partitions) {
      this.log = new Log(cfg.partitions, cfg.retention * TICKS_PER_SECOND)
      this.readers = this.newReaders()
    }
    this.log.retention = cfg.retention * TICKS_PER_SECOND

    const signature = JSON.stringify([cfg.mode, cfg.present, cfg.counts, cfg.partitions, cfg.key, cfg.retention, cfg.commit, cfg.dedupe, cfg.outage, cfg.crashy])
    if (signature === this.signature) return
    if (cfg.mode !== this.lastMode && this.channel) this.channel.jobs.length = 0
    this.lastMode = cfg.mode
    this.signature = signature
    this.reset()
  }

  // Events waiting for a team, not yet started.
  behind(team: Team): number {
    const waiting = this.consumers.reduce((sum, c) => sum + (c.team === team ? c.queue.length : 0), 0)
    if (this.cfg.mode === 'stream') return waiting + this.readers[team].behind(this.log)
    if (this.cfg.mode === 'queue') return waiting + (this.channel?.jobs.length ?? 0)
    return waiting
  }

  sample() {
    const t = this.tally
    this.history.push({ processed: t.processed.email + t.processed.stats + t.processed.stock, dropped: this.flow.stats.dropped, completed: this.flow.stats.completed })
    if (this.history.length > WINDOW + 1) this.history.shift()
  }

  // Share of events turned away or missed over the last few seconds.
  get errorRate(): number {
    const h = this.history
    if (h.length < 2) return 0
    const dropped = h[h.length - 1].dropped - h[0].dropped
    const done = h[h.length - 1].completed - h[0].completed
    return dropped + done === 0 ? 0 : (dropped / (dropped + done)) * 100
  }

  // Events finished per second, over the last few seconds.
  get doneRate(): number {
    const h = this.history
    if (h.length < 2) return 0
    return ((h[h.length - 1].processed - h[0].processed) * TICKS_PER_SECOND) / (h.length - 1)
  }
}
