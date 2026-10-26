import { FlowSim, type FlowNode, type Job } from '../../core/flow/engine'

// The news feed, as a running system. Two kinds of request:
//   an open:  reader → (cache) → feed server → feed store, which answers with lookups
//   a post:   writer → (queue) → fan-out worker → feed store, as one write per follower
// What an open and a post cost depends on the mode: nothing is copied at post time
// (read), every post is copied into each follower's inbox (write), or only normal
// accounts are copied and a celebrity is looked up when the feed opens (hybrid).
// The pieces are all optional, so a bad design shows how it fails.

export const TICKS_PER_SECOND = 20
export const SECOND = TICKS_PER_SECOND

export type Mode = 'read' | 'write' | 'hybrid'
export const MODES: Mode[] = ['read', 'write', 'hybrid']

const FOLLOWS = 16 // accounts a reader follows
// Followers per account. A real celebrity has millions, so one post here stands for millions of writes.
export const FOLLOWERS = { normal: 20, star: 2000 }
export const IDLE_SHARE = 0.6 // share of followers who have been away for a long time
const IDLE_OPENS = 0.15 // share of opens that come from a reader who has been away
const READERS = 24
const CACHE_TTL = 3 * SECOND
const SHARD_SLOTS = 6
const SHARD_LINE = 40
const WRITE_ROOM = 30 // a worker only sends a write while the shard has fewer than this waiting
const SEND = 3 // writes one fan-out worker sends per tick
const SERVER_SLOTS = 8
const SERVER_LINE = 24
const QUEUE_CAPACITY = 400
const NO_QUEUE_LINE = 1 // posts a worker can hold at once when nothing queues them
const RECENT = 10 * SECOND

export interface Phase {
  from: number // tick
  opens: number // per second
  posts: number // per second, from normal accounts
}

export interface Config {
  mode: Mode
  queue: boolean
  cache: boolean
  skipIdle: boolean // do not write to the inboxes of followers who have been away
  workers: string[] // keys of the fan-out workers
  shards: string[] // keys of the feed store's shards
  phases: Phase[]
  stars: number[] // ticks when the celebrity posts
  coldAt?: number // the cache loses everything at this tick
  jam?: string[] // parts standing where requests cannot get through: they turn everything away
  keys: { queue: string; cache: string }
}

export interface Tally {
  opened: number // feeds delivered
  failed: number // opens turned away
  hits: number // opens the cache answered
  posted: number // posts made
  lost: number // posts a worker turned away
  delivered: number // posts that reached every inbox
  starLost: number
}

const blank = (): Tally => ({ opened: 0, failed: 0, hits: 0, posted: 0, lost: 0, delivered: 0, starLost: 0 })

// Tells the system when something was thrown away on its way.
class Net extends FlowSim {
  onLoss?: (job: Job) => void
  drop(job: Job, node: string) {
    super.drop(job, node)
    this.onLoss?.(job)
  }
}

// Workers that take a few at a time: a server or a shard of the store.
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

// Where requests start: the readers opening the app, or the writers posting.
class Traffic implements FlowNode {
  alive = true
  readonly key: string
  private feed: Feed
  private reading: boolean
  private due = 0
  constructor(feed: Feed, reading: boolean) {
    this.key = reading ? 'readers' : 'writers'
    this.feed = feed
    this.reading = reading
  }
  receive() {}
  emit(sim: FlowSim) {
    const f = this.feed
    const { phases, stars, coldAt } = f.cfg
    const phase = [...phases].reverse().find((p) => p.from <= sim.tick)
    if (phase) this.due += (this.reading ? phase.opens : phase.posts) / SECOND
    for (; this.due >= 1; this.due--) {
      if (this.reading) f.open(sim)
      else f.post(sim, false)
    }
    if (this.reading) {
      if (coldAt === sim.tick) f.cached.clear()
    } else if (stars.includes(sim.tick)) f.post(sim, true)
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

// Remembers each reader's feed for a few seconds.
class Cache implements FlowNode {
  alive = true
  readonly key: string
  private feed: Feed
  constructor(key: string, feed: Feed) {
    this.key = key
    this.feed = feed
  }
  receive(job: Job, sim: FlowSim) {
    const at = this.feed.cached.get(job.key!)
    if (at !== undefined && sim.tick - at < CACHE_TTL && !this.feed.rebuilds.has(job.id)) {
      this.feed.tally.hits++
      this.feed.tally.opened++
      return sim.complete(job)
    }
    sim.forward(job, this.key, 'feed')
  }
}

// Holds posts until a worker is free.
class Queue implements FlowNode {
  alive = true
  jobs: Job[] = []
  readonly key: string
  private feed: Feed
  constructor(key: string, feed: Feed) {
    this.key = key
    this.feed = feed
  }
  receive(job: Job, sim: FlowSim) {
    if (this.jobs.length >= QUEUE_CAPACITY) return sim.drop(job, this.key)
    this.jobs.push(job)
  }
  process(sim: FlowSim) {
    for (const w of this.feed.fanouts) {
      if (this.jobs.length === 0) break
      if (w.alive && sim.pending(w) === 0) sim.forward(this.jobs.shift()!, this.key, w.key)
    }
  }
  load() {
    return this.jobs.length
  }
}

// Copies a post into the inboxes, a few writes a tick, and waits when the store is busy.
class Fanout implements FlowNode {
  alive = true
  todo: { job: Job; left: number }[] = []
  readonly key: string
  private feed: Feed
  constructor(key: string, feed: Feed) {
    this.key = key
    this.feed = feed
  }
  free() {
    return this.alive && this.todo.length < (this.feed.cfg.queue ? 1 : NO_QUEUE_LINE)
  }
  receive(job: Job, sim: FlowSim) {
    if (!this.free()) return sim.drop(job, this.key)
    this.todo.push({ job, left: this.feed.copies(job) })
  }
  process(sim: FlowSim) {
    let budget = SEND
    while (budget > 0 && this.todo.length) {
      const cur = this.todo[0]
      const shard = this.feed.shardFor(cur.left + cur.job.id)
      if (shard.load() >= WRITE_ROOM) break
      const write = sim.newJob(1, undefined, 'write')
      write.msg = cur.job.id
      sim.forward(write, this.key, shard.key)
      budget--
      if (--cur.left === 0) this.todo.shift()
    }
  }
  load() {
    return this.todo.reduce((n, t) => n + t.left, 0)
  }
  lose() {
    const lost = this.todo.map((t) => t.job)
    this.todo = []
    return lost
  }
}

export class Feed {
  readonly flow: Net
  readonly cfg: Config
  readonly tally = blank()
  readonly cached = new Map<number, number>() // reader → tick the feed was built
  readonly rebuilds = new Set<number>() // opens from a reader who has been away, under skipIdle
  readonly fanouts: Fanout[] = []
  readonly shards: Pool[] = []
  private opens = new Map<number, { job: Job; need: number; got: number; dead: boolean }>()
  private posts = new Map<number, { left: number; at: number; star: boolean }>()
  private delays: { at: number; delay: number; star: boolean }[] = []
  private round = 0

  constructor(rng: () => number, cfg: Config) {
    this.cfg = cfg
    const flow = (this.flow = new Net(rng))
    flow.onLoss = (job) => this.lose(job)
    flow.traffic = () => {
      const phase = [...cfg.phases].reverse().find((p) => p.from <= flow.tick)
      return phase ? phase.opens + phase.posts : 0
    }
    flow.add(new Traffic(this, true))
    flow.add(new Traffic(this, false))
    if (cfg.cache) flow.add(cfg.jam?.includes(cfg.keys.cache) ? new Jam(cfg.keys.cache) : new Cache(cfg.keys.cache, this))
    flow.add(new Pool('feed', SERVER_SLOTS, SERVER_LINE, (job, sim) => this.answer(job, sim)))
    for (const key of cfg.shards) {
      const shard = flow.add(new Pool(key, SHARD_SLOTS, SHARD_LINE, (job, sim) => this.stored(job, sim)))
      this.shards.push(shard)
      flow.link('feed', key, 6)
    }
    if (cfg.queue) flow.add(cfg.jam?.includes(cfg.keys.queue) ? new Jam(cfg.keys.queue) : new Queue(cfg.keys.queue, this))
    for (const key of cfg.workers) {
      const w = flow.add(new Fanout(key, this))
      this.fanouts.push(w)
      if (cfg.queue) flow.link(cfg.keys.queue, key, 0)
      for (const s of cfg.shards) flow.link(key, s, 6)
    }
    flow.link('readers', cfg.cache ? cfg.keys.cache : 'feed', 6)
    if (cfg.cache) flow.link(cfg.keys.cache, 'feed', 0)
    for (const target of cfg.queue ? [cfg.keys.queue] : cfg.workers) flow.link('writers', target, 6)
  }

  // --- Requests coming in -----------------------------------------------------

  open(sim: FlowSim) {
    const reader = Math.floor(sim.rng() ** 2 * READERS)
    const job = sim.newJob(1, reader, 'open')
    if (this.cfg.skipIdle && this.cfg.mode !== 'read' && sim.rng() < IDLE_OPENS) this.rebuilds.add(job.id)
    sim.forward(job, 'readers', this.cfg.cache ? this.cfg.keys.cache : 'feed')
  }

  post(sim: FlowSim, star: boolean) {
    const job = sim.newJob(0, star ? -1 : undefined, 'post')
    this.tally.posted++
    this.posts.set(job.id, { left: this.copies(job), at: sim.tick, star })
    const next = this.cfg.queue ? this.cfg.keys.queue : this.fanouts[this.round++ % this.fanouts.length]?.key
    if (next) sim.forward(job, 'writers', next)
    else sim.drop(job, 'writers')
  }

  // Writes one post needs.
  copies(job: Job) {
    const star = job.key === -1
    const { mode, skipIdle } = this.cfg
    if (mode === 'read' || (mode === 'hybrid' && star)) return 1
    const followers = star ? FOLLOWERS.star : FOLLOWERS.normal
    return Math.ceil(followers * (skipIdle ? 1 - IDLE_SHARE : 1))
  }

  shardFor(n: number) {
    return this.shards[Math.abs(n) % this.shards.length]
  }

  // --- Answering ----------------------------------------------------------------

  // The feed server has an open: ask the store for what the feed is made of.
  private answer(job: Job, sim: FlowSim) {
    const { mode } = this.cfg
    const reader = job.key!
    const rebuild = this.rebuilds.has(job.id) || mode === 'read'
    const need = rebuild ? FOLLOWS : mode === 'write' ? 1 : 2
    this.opens.set(job.id, { job, need, got: 0, dead: false })
    for (let i = 0; i < need; i++) {
      const read = sim.newJob(1, undefined, 'read')
      read.msg = job.id
      // One lookup per account, spread over the store. The celebrity is one account: one shard holds it.
      const shard = !rebuild && mode === 'hybrid' && i === 1 ? this.shards[0] : this.shardFor(reader + i)
      sim.forward(read, 'feed', shard.key)
    }
  }

  // A shard finished a lookup or a write.
  private stored(job: Job, sim: FlowSim) {
    if (job.from === 'write') return this.written(job, sim)
    const o = this.opens.get(job.msg!)
    if (!o || o.dead) return
    if (++o.got < o.need) return
    this.opens.delete(job.msg!)
    this.cached.set(o.job.key!, sim.tick)
    this.tally.opened++
    sim.complete(o.job)
  }

  private written(job: Job, sim: FlowSim) {
    const p = this.posts.get(job.msg!)
    if (!p || --p.left > 0) return
    this.posts.delete(job.msg!)
    this.tally.delivered++
    this.delays.push({ at: sim.tick, delay: sim.tick - p.at, star: p.star })
  }

  // Something was thrown away on its way.
  private lose(job: Job) {
    if (job.from === 'open' || job.from === 'read') {
      const id = job.from === 'open' ? job.id : job.msg!
      const o = this.opens.get(id)
      if (job.from === 'open') this.tally.failed++
      else if (o && !o.dead) {
        o.dead = true
        this.tally.failed++
      }
    } else if (job.from === 'post' || job.from === 'write') {
      const id = job.from === 'post' ? job.id : job.msg!
      const p = this.posts.get(id)
      if (!p) return
      this.posts.delete(id)
      this.tally.lost++
      if (p.star) this.tally.starLost++
    }
  }

  // --- What the checks read -----------------------------------------------------

  // Seconds an average open took, over the last few hundred.
  wait() {
    return this.flow.avgLatency() / SECOND
  }

  // Seconds the slowest post of the last 10 seconds took to reach every inbox: the celebrity's, or a normal account's.
  slowest(star = false) {
    const t = this.flow.tick
    return Math.max(0, ...this.delays.filter((d) => d.star === star && t - d.at < RECENT).map((d) => d.delay)) / SECOND
  }

  // Writes and posts waiting to be copied.
  backlog() {
    return this.fanouts.reduce((n, w) => n + w.load(), 0) + this.flow.all().reduce((n, x) => n + (x instanceof Queue ? x.load() : 0), 0)
  }

  // Share of the store's lookups and writes that are waiting for a free slot, 0 to 1.
  storeLoad() {
    return Math.max(0, ...this.shards.map((s) => s.load() / SHARD_LINE))
  }
}
