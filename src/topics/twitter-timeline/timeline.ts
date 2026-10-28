import { FlowSim, type FlowNode, type Job } from '../../core/flow/engine'

// The Twitter timeline, as a running system. Two paths share the same machines:
//   an open:  reader → (timeline cache) → timeline server → tweet store, as lookups
//   a tweet:  writer → (queue) → fan-out worker → the timelines, one write per follower
// The timelines live in the cache when there is one, and in the store when there is not.
// Accounts come in three sizes: small, mid and a celebrity. A cutoff decides which sizes
// are looked up when a timeline opens; the rest are written into every follower's timeline.
// Timelines hold either whole tweets or only their ids. Ids make an edit or a delete one
// write, but every open must then fetch the tweets it shows.
// A cache that loses its timelines sends every reader to the store to be rebuilt. If the
// store turns lookups away and the readers retry at once, the retries pile on top.

export const TICKS_PER_SECOND = 20
export const SECOND = TICKS_PER_SECOND

export type Kind = 'small' | 'mid' | 'star'
export const KINDS: Kind[] = ['small', 'mid', 'star']
// How many sizes are looked up when a timeline opens: none, the celebrity, the celebrity and mid accounts, all.
export const CUTOFFS = 4
export const lookedUp = (cutoff: number, kind: Kind) => cutoff > 2 - KINDS.indexOf(kind)

// Accounts of each size that a reader follows.
export const FOLLOWED: Record<Kind, number> = { small: 7, mid: 8, star: 1 }
// Followers per account. A real celebrity has millions, so one tweet here stands for millions of writes.
export const FOLLOWERS: Record<Kind, number> = { small: 20, mid: 100, star: 2000 }
// What those accounts stand for in real life. The board runs the small numbers; what the learner reads is these.
export const REAL_FOLLOWERS: Record<Kind, number> = { small: 200, mid: 10_000, star: 50_000_000 }
export const spoken = (n: number) => (n >= 1_000_000 ? `${n / 1_000_000} million` : n.toLocaleString())
export const READERS = 40
export const HYDRATE = 3 // lookups to fetch the tweets a timeline of ids shows
export const REBUILD = 12 // lookups to rebuild a lost timeline of LENGTH tweets: the newest tweets of every followed account, in batches
export const LENGTH = 800 // tweets a timeline keeps, unless the design says otherwise
export const SCROLL_AT = 600 // a reader scrolls about this far; a shorter timeline sends the rest to the store
export const SCROLL_PER = 100 // tweets short of SCROLL_AT for each extra lookup
const SHARD_SLOTS = 6
const SHARD_LINE = 60
const CACHE_SLOTS = 12
const CACHE_LINE = 60
const WRITE_ROOM = 30 // a worker only sends a write while the holder has fewer than this waiting
const SEND = 6 // writes one fan-out worker sends per tick
const SERVER_SLOTS = 8
const SERVER_LINE = 24
const QUEUE_CAPACITY = 400
const NO_QUEUE_LINE = 1 // tweets a worker can hold at once when nothing queues them
const RECENT = 10 * SECOND
const MID_EVERY = 6 // one delete in this many is of a mid account's tweet

export const RETRY_NOW = 0
export const RETRY_LATER = 1
export const RETRY_NEVER = 2

export interface Phase {
  from: number // tick
  opens: number // per second
  posts: number // per second, from small accounts
  mids?: number // per second, from mid accounts
  deletes?: number // tweets deleted or edited per second
}

// A rate limiter standing in front of one lane.
export interface Limit {
  key: string
  lane: 'read' | 'write'
  rate: number // requests per second it lets through
}

export interface Config {
  cutoff: number // 0 = every tweet is written to timelines, 3 = every tweet is looked up when a timeline opens
  thin: boolean // timelines hold only ids
  length?: number // tweets a timeline keeps (LENGTH if left out): a short one makes scrolling reach the store, a long one makes a rebuild cost more
  collapse: boolean // one rebuild per reader: the other opens wait for it
  retry: number // RETRY_NOW, RETRY_LATER or RETRY_NEVER
  queue: boolean
  caches: string[] // keys of the timeline caches
  servers: string[] // keys of the timeline servers: apps on the readers' side
  workers: string[] // keys of the fan-out workers: apps on the writers' side
  shards: string[] // keys of the tweet store's shards
  phases: Phase[]
  stars: number[] // ticks when the celebrity tweets
  limits?: Limit[]
  coldAt?: number // the first cache loses its timelines at this tick
  jam?: string[] // parts standing where requests cannot get through: they turn everything away
  keys: { queue: string }
}

export interface Tally {
  opened: number // timelines delivered
  failed: number // opens given up on
  retried: number // opens sent again
  hits: number // opens the cache held a timeline for
  posted: number // tweets made
  lost: number // tweets a worker turned away
  delivered: number // tweets that reached every timeline
  starLost: number
  deleted: number // deletes and edits made
  delLost: number // deletes a worker turned away
  gone: number // deletes that reached every copy
  limited: number // requests a rate limiter turned away
}

const blank = (): Tally => ({ opened: 0, failed: 0, retried: 0, hits: 0, posted: 0, lost: 0, delivered: 0, starLost: 0, deleted: 0, delLost: 0, gone: 0, limited: 0 })

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

// Holds the timelines of the readers it is responsible for. Opens and writes share its slots.
class TimelineCache extends Pool {
  readonly warm = new Set<number>() // readers whose timeline is here
  constructor(key: string, feed: Timeline) {
    super(key, CACHE_SLOTS, CACHE_LINE, (job, sim) => feed.cacheDone(this, job, sim))
  }
}

// Where requests start: the readers opening the app, or the writers tweeting.
class Traffic implements FlowNode {
  alive = true
  readonly key: string
  private feed: Timeline
  private reading: boolean
  private due = 0
  private dueMids = 0
  private dueDeletes = 0
  private deletes = 0
  constructor(feed: Timeline, reading: boolean) {
    this.key = reading ? 'readers' : 'writers'
    this.feed = feed
    this.reading = reading
  }
  receive() {}
  emit(sim: FlowSim) {
    const f = this.feed
    const { phases, stars, coldAt } = f.cfg
    const phase = [...phases].reverse().find((p) => p.from <= sim.tick)
    if (phase) {
      this.due += (this.reading ? phase.opens : phase.posts) / SECOND
      if (!this.reading) {
        this.dueMids += (phase.mids ?? 0) / SECOND
        this.dueDeletes += (phase.deletes ?? 0) / SECOND
      }
    }
    for (; this.due >= 1; this.due--) {
      if (this.reading) f.open(sim)
      else f.post(sim, 'small', false)
    }
    for (; this.dueMids >= 1; this.dueMids--) f.post(sim, 'mid', false)
    for (; this.dueDeletes >= 1; this.dueDeletes--) f.post(sim, ++this.deletes % MID_EVERY === 0 ? 'mid' : 'small', true)
    if (this.reading) {
      f.releaseRetries(sim)
      if (coldAt === sim.tick) f.wipe()
    } else if (stars.includes(sim.tick)) f.post(sim, 'star', false)
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
  private feed: Timeline
  private lane: 'read' | 'write'
  private rate: number
  private tokens: number
  private last = 0
  constructor(limit: Limit, feed: Timeline) {
    this.key = limit.key
    this.lane = limit.lane
    this.rate = limit.rate
    this.tokens = limit.rate
    this.feed = feed
  }
  receive(job: Job, sim: FlowSim) {
    this.tokens = Math.min(this.rate, this.tokens + ((sim.tick - this.last) * this.rate) / SECOND)
    this.last = sim.tick
    if (this.tokens < 1) {
      this.feed.tally.limited++
      return sim.drop(job, this.key)
    }
    this.tokens--
    this.feed.pass(job, this.lane, this.key, sim)
  }
}

// Holds tweets until a worker is free.
class Queue implements FlowNode {
  alive = true
  jobs: Job[] = []
  readonly key: string
  private feed: Timeline
  constructor(key: string, feed: Timeline) {
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

// Writes a tweet into the timelines, a few writes a tick, and waits when the holder is busy.
class Fanout implements FlowNode {
  alive = true
  todo: { job: Job; left: number }[] = []
  readonly key: string
  private feed: Timeline
  constructor(key: string, feed: Timeline) {
    this.key = key
    this.feed = feed
  }
  free() {
    return this.alive && this.todo.length < (this.feed.cfg.queue ? 1 : NO_QUEUE_LINE)
  }
  receive(job: Job, sim: FlowSim) {
    if (!this.free()) return sim.drop(job, this.key)
    this.todo.push({ job, left: this.feed.copiesOf(job) })
  }
  process(sim: FlowSim) {
    let budget = SEND
    // Writes a busy holder turned away are sent again before anything new.
    while (budget > 0 && this.feed.resend.length) {
      const to = this.feed.holderFor(this.feed.resend[0])
      if (this.feed.holderLoad(to) >= WRITE_ROOM) break
      const write = sim.newJob(1, undefined, 'write')
      write.msg = this.feed.resend.shift()
      sim.forward(write, this.key, to)
      budget--
    }
    while (budget > 0 && this.todo.length) {
      const cur = this.todo[0]
      const to = this.feed.holderFor(cur.left + cur.job.id)
      if (this.feed.holderLoad(to) >= WRITE_ROOM) break
      const write = sim.newJob(1, undefined, 'write')
      write.msg = cur.job.id
      sim.forward(write, this.key, to)
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

interface Open {
  job: Job
  need: number
  got: number
  dead: boolean
  mode: 'hit' | 'rebuild' | 'plain'
}

export class Timeline {
  readonly flow: Net
  readonly cfg: Config
  readonly tally = blank()
  readonly worst = { tweet: 0, star: 0, delete: 0 } // the longest a tweet, a celebrity tweet or a delete took to reach every timeline, over the whole run, in seconds
  readonly resend: number[] = [] // tweets with a write that a busy holder turned away
  readonly fanouts: Fanout[] = []
  readonly servers: Pool[] = []
  readonly shards: Pool[] = []
  readonly caches: TimelineCache[] = []
  private cacheKeys: string[] = []
  private opens = new Map<number, Open>()
  private posts = new Map<number, { left: number; at: number; star: boolean; del: boolean }>()
  private rebuilding = new Map<number, Job[]>() // readers being rebuilt, and the opens waiting for it
  private retries: { at: number; reader: number; tries: number }[] = []
  private route: Record<'read' | 'write', string[]> = { read: [], write: [] }
  private delays: { at: number; delay: number; what: 'tweet' | 'star' | 'delete' }[] = []
  private round = 0
  private broken: boolean // a lane has no machine at all: nothing can be served

  constructor(rng: () => number, cfg: Config) {
    this.cfg = cfg
    this.broken = !cfg.servers.length || !cfg.workers.length || !cfg.shards.length
    const flow = (this.flow = new Net(rng))
    flow.onLoss = (job) => this.lose(job)
    flow.traffic = () => {
      const phase = [...cfg.phases].reverse().find((p) => p.from <= flow.tick)
      return phase ? phase.opens + phase.posts : 0
    }
    flow.add(new Traffic(this, true))
    flow.add(new Traffic(this, false))
    for (const l of cfg.limits ?? []) {
      flow.add(new Limiter(l, this))
      this.route[l.lane].push(l.key)
    }
    this.cacheKeys = cfg.caches
    if (cfg.caches.length) this.route.read.push('@cache')
    this.route.read.push('@server')
    if (cfg.queue) this.route.write.push(cfg.keys.queue)
    for (const key of cfg.caches) {
      if (cfg.jam?.includes(key)) {
        flow.add(new Jam(key))
        continue
      }
      const c = flow.add(new TimelineCache(key, this))
      for (let r = 0; r < READERS; r++) c.warm.add(r)
      this.caches.push(c)
    }
    for (const key of cfg.servers) {
      this.servers.push(flow.add(new Pool(key, SERVER_SLOTS, SERVER_LINE, (job, sim) => this.answer(job, sim, key))))
      for (const c of cfg.caches) flow.link(c, key, 0)
    }
    for (const key of cfg.shards) {
      const shard = flow.add(new Pool(key, SHARD_SLOTS, SHARD_LINE, (job, sim) => this.stored(job, sim)))
      this.shards.push(shard)
      for (const sv of cfg.servers) flow.link(sv, key, 6)
      for (const c of cfg.caches) flow.link(c, key, 6)
    }
    if (cfg.queue) flow.add(cfg.jam?.includes(cfg.keys.queue) ? new Jam(cfg.keys.queue) : new Queue(cfg.keys.queue, this))
    for (const key of cfg.workers) {
      const w = flow.add(new Fanout(key, this))
      this.fanouts.push(w)
      if (cfg.queue) flow.link(cfg.keys.queue, key, 0)
      for (const h of cfg.caches.length ? cfg.caches : cfg.shards) flow.link(key, h, 6)
    }
    // The read lane: each hop is a link. The cache tier is one hop to whichever cache holds the reader.
    const expand = (k: string) => (k === '@cache' ? cfg.caches : k === '@server' ? cfg.servers : [k])
    const reads = this.route.read
    for (const to of expand(reads[0])) flow.link('readers', to, 6)
    for (let i = 1; i < reads.length; i++) for (const from of expand(reads[i - 1])) for (const to of expand(reads[i])) flow.link(from, to, 0)
    const into = this.route.write
    into.forEach((key, i) => flow.link(i === 0 ? 'writers' : into[i - 1], key, i === 0 ? 6 : 0))
    if (!cfg.queue) for (const w of cfg.workers) flow.link(into.length ? into[into.length - 1] : 'writers', w, into.length ? 0 : 6)
  }

  // --- Requests coming in -----------------------------------------------------

  open(sim: FlowSim, reader?: number, tries = 0) {
    const who = reader ?? Math.floor(sim.rng() ** 2 * READERS)
    const job = sim.newJob(1, who, 'open')
    job.attempts = tries
    this.pass(job, 'read', 'readers', sim)
  }

  post(sim: FlowSim, kind: Kind, del: boolean) {
    const job = sim.newJob(0, kind === 'star' ? -1 : kind === 'mid' ? -2 : undefined, 'post')
    if (del) this.tally.deleted++
    else this.tally.posted++
    this.posts.set(job.id, { left: this.cost(kind, del), at: sim.tick, star: kind === 'star', del })
    this.pass(job, 'write', 'writers', sim)
  }

  // Send a request on to whatever stands after `from` in its lane.
  pass(job: Job, lane: 'read' | 'write', from: string, sim: FlowSim) {
    if (this.broken) return sim.drop(job, from)
    const route = this.route[lane]
    const at = this.cacheKeys.includes(from) ? '@cache' : this.cfg.servers.includes(from) ? '@server' : from
    let next = route[route.indexOf(at) + 1] ?? (lane === 'write' ? this.fanouts[this.round++ % this.fanouts.length]?.key : undefined)
    if (next === '@cache') next = this.cacheKeys[job.key! % this.cacheKeys.length]
    if (next === '@server') next = this.cfg.servers[job.key! % this.cfg.servers.length]
    if (next) sim.forward(job, from, next)
    else sim.drop(job, from)
  }

  kindOf(job: Job): Kind {
    return job.key === -1 ? 'star' : job.key === -2 ? 'mid' : 'small'
  }

  // Writes one tweet, or one delete, needs.
  cost(kind: Kind, del: boolean) {
    if (del && this.cfg.thin) return 1 // the tweet itself: timelines only point at it
    if (lookedUp(this.cfg.cutoff, kind)) return 1
    return FOLLOWERS[kind]
  }

  copiesOf(job: Job) {
    return this.posts.get(job.id)?.left ?? 1
  }

  // Where the n-th write of a tweet goes: the cache that holds that follower's timeline, or a shard.
  holderFor(n: number) {
    const keys = this.cacheKeys.length ? this.cacheKeys : this.cfg.shards
    return keys[Math.abs(n) % keys.length]
  }

  holderLoad(key: string) {
    return this.flow.node(key)?.load?.() ?? 0
  }

  shardFor(n: number) {
    return this.shards[Math.abs(n) % this.shards.length]
  }

  private cacheFor(reader: number) {
    return this.caches.find((c) => c.key === this.cacheKeys[reader % this.cacheKeys.length])
  }

  // The cache loses every timeline it held.
  wipe() {
    this.caches[0]?.warm.clear()
  }

  // --- Answering ----------------------------------------------------------------

  // Lookups for the accounts that are not written into timelines, and for the tweets a timeline of ids shows.
  private extras(reader: number) {
    const targets: Pool[] = []
    for (const kind of KINDS) {
      if (!lookedUp(this.cfg.cutoff, kind)) continue
      for (let i = 0; i < FOLLOWED[kind]; i++) targets.push(this.shardFor(reader + i))
    }
    if (this.cfg.thin) for (let i = 0; i < HYDRATE; i++) targets.push(this.shardFor(reader + 7 + i))
    for (let i = 0; i < Math.ceil((SCROLL_AT - (this.cfg.length ?? LENGTH)) / SCROLL_PER); i++) targets.push(this.shardFor(reader + 11 + i))
    return targets
  }

  private ask(job: Job, targets: Pool[], from: string, sim: FlowSim, mode: Open['mode']) {
    if (targets.length === 0) return this.finish({ job, need: 0, got: 0, dead: false, mode })
    this.opens.set(job.id, { job, need: targets.length, got: 0, dead: false, mode })
    for (const shard of targets) {
      const read = sim.newJob(1, undefined, 'read')
      read.msg = job.id
      sim.forward(read, from, shard.key)
    }
  }

  // The cache finished a slot of work: a write into a timeline, or an open.
  cacheDone(cache: TimelineCache, job: Job, sim: FlowSim) {
    if (job.from === 'write') return this.written(job, sim)
    if (cache.warm.has(job.key!)) this.ask(job, this.extras(job.key!), cache.key, sim, 'hit')
    else sim.forward(job, cache.key, this.cfg.servers[job.key! % this.cfg.servers.length])
  }

  // The timeline server has an open: ask the store for what the timeline is made of.
  private answer(job: Job, sim: FlowSim, from: string) {
    const reader = job.key!
    if (!this.cacheKeys.length) {
      // The timelines are in the store: one lookup for the reader's own, then the rest.
      const targets = this.cfg.cutoff < CUTOFFS - 1 ? [this.shardFor(reader)] : []
      return this.ask(job, [...targets, ...this.extras(reader)], from, sim, 'plain')
    }
    // The timeline is gone from the cache: build it again from the accounts the reader follows.
    if (this.cfg.collapse) {
      const waiting = this.rebuilding.get(reader)
      if (waiting) return void waiting.push(job)
      this.rebuilding.set(reader, [])
    }
    const targets: Pool[] = []
    for (let i = 0; i < Math.max(1, Math.round((REBUILD * (this.cfg.length ?? LENGTH)) / LENGTH)); i++) targets.push(this.shardFor(reader + i))
    if (this.cfg.thin) for (let i = 0; i < HYDRATE; i++) targets.push(this.shardFor(reader + 7 + i))
    this.ask(job, targets, from, sim, 'rebuild')
  }

  // A shard finished a lookup or a write.
  private stored(job: Job, sim: FlowSim) {
    if (job.from === 'write') return this.written(job, sim)
    const o = this.opens.get(job.msg!)
    if (!o || o.dead) return
    if (++o.got < o.need) return
    this.opens.delete(job.msg!)
    this.finish(o)
  }

  private finish(o: Open) {
    const reader = o.job.key!
    const done = [o.job]
    if (o.mode === 'hit') this.tally.hits++
    if (o.mode === 'rebuild') {
      const c = this.cacheFor(reader)
      if (c?.alive) c.warm.add(reader)
      done.push(...(this.rebuilding.get(reader) ?? []))
      this.rebuilding.delete(reader)
    }
    for (const j of done) {
      this.tally.opened++
      this.flow.complete(j)
    }
  }

  private written(job: Job, sim: FlowSim) {
    const p = this.posts.get(job.msg!)
    if (!p || --p.left > 0) return
    this.posts.delete(job.msg!)
    if (p.del) this.tally.gone++
    else this.tally.delivered++
    const what = p.del ? 'delete' : p.star ? 'star' : 'tweet'
    this.delays.push({ at: sim.tick, delay: sim.tick - p.at, what })
    this.worst[what] = Math.max(this.worst[what], (sim.tick - p.at) / SECOND)
  }

  // --- When things go wrong ------------------------------------------------------

  // Something was thrown away on its way.
  private lose(job: Job) {
    if (job.from === 'open') this.giveUp(job)
    else if (job.from === 'read') {
      const o = this.opens.get(job.msg!)
      if (!o || o.dead) return
      o.dead = true
      this.opens.delete(job.msg!)
      const waiting = o.mode === 'rebuild' ? (this.rebuilding.get(o.job.key!) ?? []) : []
      if (o.mode === 'rebuild') this.rebuilding.delete(o.job.key!)
      for (const j of [o.job, ...waiting]) this.giveUp(j)
    } else if (job.from === 'write') {
      if (this.posts.has(job.msg!)) this.resend.push(job.msg!)
    } else if (job.from === 'post') {
      const p = this.posts.get(job.id)
      if (!p) return
      this.posts.delete(job.id)
      if (p.del) this.tally.delLost++
      else this.tally.lost++
      if (p.star) this.tally.starLost++
    }
  }

  // An open did not get through: the reader tries again, or gives up.
  private giveUp(job: Job) {
    const tries = job.attempts ?? 0
    const { retry } = this.cfg
    const most = retry === RETRY_NOW ? 3 : retry === RETRY_LATER ? 1 : 0
    if (tries >= most) {
      this.tally.failed++
      return
    }
    this.tally.retried++
    const wait = retry === RETRY_NOW ? 1 : SECOND + Math.floor(this.flow.rng() * SECOND * 0.5)
    this.retries.push({ at: this.flow.tick + wait, reader: job.key!, tries: tries + 1 })
  }

  releaseRetries(sim: FlowSim) {
    if (!this.retries.length) return
    const due = this.retries.filter((r) => r.at <= sim.tick)
    if (!due.length) return
    this.retries = this.retries.filter((r) => r.at > sim.tick)
    for (const r of due) this.open(sim, r.reader, r.tries)
  }

  // --- What the checks read -----------------------------------------------------

  // Seconds an average open took, over the last few hundred.
  wait() {
    return this.flow.avgLatency() / SECOND
  }

  // Seconds the slowest of the last 10 seconds took to reach every timeline: a normal tweet, the celebrity's, or a delete.
  slowest(what: 'tweet' | 'star' | 'delete' = 'tweet') {
    const t = this.flow.tick
    return Math.max(0, ...this.delays.filter((d) => d.what === what && t - d.at < RECENT).map((d) => d.delay)) / SECOND
  }

  // Writes and tweets waiting to be written into timelines.
  backlog() {
    return this.fanouts.reduce((n, w) => n + w.load(), 0) + this.flow.all().reduce((n, x) => n + (x instanceof Queue ? x.load() : 0), 0)
  }

  // Share of the store's lookups that are waiting for a free slot, 0 to 1.
  storeLoad() {
    return Math.max(0, ...this.shards.map((s) => s.load() / SHARD_LINE))
  }

  // The same for the busiest timeline server.
  serverLoad() {
    return Math.max(0, ...this.servers.map((s) => s.load() / SERVER_LINE))
  }

  // The same for the busiest cache.
  cacheLoad() {
    return Math.max(0, ...this.caches.map((c) => c.load() / CACHE_LINE))
  }
}
