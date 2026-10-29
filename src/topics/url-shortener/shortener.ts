import { Cache } from '../../core/flow/cache'
import { FlowSim, type FlowNode, type Job } from '../../core/flow/engine'
import { Router, Source, Worker } from '../../core/flow/nodes'
import { Fifo } from '../../core/flow/queue'
import { pick, zipfTable } from '../../core/flow/popularity'

// The URL shortener, as a running system. Three kinds of traffic:
//   users  → redirects (a short code in, the long link out). Most of the load.
//   makers → real people creating short links.
//   bot    → a script creating links as fast as it can.
// Every redirect also records a click. Creates need a fresh code, picked by
// the app server with the scheme the learner chose.

export const TICKS_PER_SECOND = 20
export const SECOND = TICKS_PER_SECOND
export const CODES = 200 // distinct short links people ask for
const SLOW_AFTER = 2 * SECOND // a redirect slower than this is a failure: the person left
const READ_WORK = 10
const WRITE_WORK = 10
const CLICK_SYNC_WORK = 4
const CLICK_QUEUED_WORK = 1
const HASH_RETRY = 0.12 // share of hashed codes that collide and need a second write
const COUNTER_CLASH = 0.25 // how often two servers on one counter hand out the same code

export type Scheme = 'counter' | 'range' | 'hash'
export type Scope = 'all' | 'creates'
export const SCHEMES: Scheme[] = ['counter', 'range', 'hash']
export const SCOPES: Scope[] = ['all', 'creates']
export const LIMITS = [1, 2, 4, 8, 16]
export const CACHE_SIZES = [10, 20, 30, 40, 50]

export interface Load {
  users: number
  makers: number
  bot: number
  hot: number // share of redirects that ask for the one viral link
}

export type Profile = (tick: number) => Load

export interface Tally {
  failed: Record<string, number> // by source, turned away by a full line
  limited: Record<string, number> // by source, turned away by the rate limiter
  slow: number // redirects that took too long
  done: Record<string, number>
  dupes: number // creates that were given a code already taken
  at: Record<string, number> // redirects turned away by a full line, by the node that was full
}

const blankTally = (): Tally => ({ failed: {}, limited: {}, slow: 0, done: {}, dupes: 0, at: {} })

// Counts what happened to each kind of request, by where it came from.
class Net extends FlowSim {
  tally = blankTally()
  gateKey = 'gate'

  drop(job: Job, node: string) {
    super.drop(job, node)
    const from = job.from ?? '?'
    const bucket = node === this.gateKey ? this.tally.limited : this.tally.failed
    bucket[from] = (bucket[from] ?? 0) + 1
    if (from === 'users' && node !== this.gateKey) this.tally.at[node] = (this.tally.at[node] ?? 0) + 1
  }

  complete(job: Job) {
    const from = job.from ?? '?'
    this.tally.done[from] = (this.tally.done[from] ?? 0) + 1
    if (from === 'users' && this.tick - job.createdAt > SLOW_AFTER) this.tally.slow++
    super.complete(job)
  }
}

// A part standing where traffic cannot get through: it turns everything away.
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

// Sets the traffic for this moment.
class Clock implements FlowNode {
  alive = true
  readonly key = 'clock'
  private apply: (tick: number) => void
  constructor(apply: (tick: number) => void) {
    this.apply = apply
  }
  receive() {}
  process(sim: FlowSim) {
    this.apply(sim.tick)
  }
}

// An app server: takes a little work per request, then sends it on by kind.
class App extends Worker {
  private shop: Shortener
  constructor(key: string, shop: Shortener) {
    super(key, { slots: 3, queueLimit: 12, workPerRequest: 3 })
    this.shop = shop
  }

  process(sim: FlowSim) {
    while (this.active.length < this.slots && this.queue.length > 0) this.active.push(this.queue.shift()!)
    const stillWorking: Job[] = []
    for (const job of this.active) {
      job.remaining -= this.speed
      if (job.remaining > 0) {
        stillWorking.push(job)
        continue
      }
      this.served++
      this.shop.route(this.key, job, sim)
    }
    this.active = stillWorking
  }
}

// A cache that spreads its misses over the database and its replicas.
class ReadCache extends Cache {
  private turn = 0
  receive(job: Job, sim: FlowSim) {
    const stores = sim.targets(this.key)
    if (stores.length > 1) {
      const first = stores[this.turn++ % stores.length]
      const rest = stores.filter((s) => s !== first)
      for (const s of stores) sim.unlink(this.key, s.key)
      for (const s of [first, ...rest]) sim.link(this.key, s.key, 5)
    }
    super.receive(job, sim)
  }
}

// Passes requests on, but only so many per second.
class Gate implements FlowNode {
  alive = true
  readonly key: string
  private window = -1
  private total = 0
  private byClient: Record<string, number> = {}
  private limit: number
  private scope: Scope
  constructor(key: string, limit: number, scope: Scope) {
    this.key = key
    this.limit = limit
    this.scope = scope
  }

  receive(job: Job, sim: FlowSim) {
    const w = Math.floor(sim.tick / SECOND)
    if (w !== this.window) {
      this.window = w
      this.total = 0
      this.byClient = {}
    }
    const from = job.from ?? '?'
    const creating = from !== 'users'
    if (this.scope === 'all') {
      if (this.total++ >= this.limit) return sim.drop(job, this.key)
    } else if (creating) {
      const n = (this.byClient[from] = (this.byClient[from] ?? 0) + 1)
      if (n > this.limit) return sim.drop(job, this.key)
    }
    const next = sim.targets(this.key)[0]
    if (next) sim.forward(job, this.key, next.key)
    else sim.drop(job, this.key)
  }
}

// Where the parts that have one fixed job stand, by node key. A piece can be
// dropped on any spot, so these are the keys of the spots they were dropped on.
export interface Keys {
  lb: string
  gate: string
  cache: string
  queue: string
}

export interface Config {
  keys?: Partial<Keys>
  jam?: string[] // parts standing in the wrong order: they turn all traffic away
  apps: string[] // keys of the app servers that stand on the floor
  balancer: boolean
  gate?: { limit: number; scope: Scope }
  cacheSize?: number
  replicas: string[]
  queue: boolean
  scheme: Scheme
  profile: Profile
}

export class Shortener {
  readonly flow: Net
  readonly cfg: Config
  readonly keys: Keys
  private reads = 0
  private table = zipfTable(CODES)
  private cache?: ReadCache
  private db: Worker

  constructor(rng: () => number, cfg: Config) {
    this.cfg = cfg
    const keys = (this.keys = { lb: cfg.keys?.lb ?? 'lb', gate: cfg.keys?.gate ?? 'gate', cache: cfg.keys?.cache ?? 'cache', queue: cfg.keys?.queue ?? 'queue' })
    const flow = (this.flow = new Net(rng))
    flow.gateKey = keys.gate
    const sources = ['users', 'makers', 'bot'].map((k) => flow.add(new Source(k)))
    const [users, makers, bot] = sources
    users.keyOf = (rand) => {
      const r = rand()
      return r < this.load(flow.tick).hot ? 0 : pick(this.table, rand())
    }

    this.db = flow.add(new Worker('db', { slots: 4, queueLimit: 40 }))
    this.db.workOf = (job) => (job.from === 'click' ? (cfg.queue ? CLICK_QUEUED_WORK : CLICK_SYNC_WORK) : job.from === 'users' ? READ_WORK : WRITE_WORK)
    this.db.onFinish = (job, sim) => this.filled(job, sim)

    const addClock = () =>
      flow.add(
        new Clock((tick) => {
          const l = this.load(tick)
          users.rate = l.users / SECOND
          makers.rate = l.makers / SECOND
          bot.rate = l.bot / SECOND
        }),
      )

    if (cfg.jam?.length) {
      for (const key of cfg.apps) if (!cfg.jam.includes(key)) flow.add(new App(key, this))
      for (const key of cfg.jam) flow.add(new Jam(key))
      for (const s of sources) for (const key of cfg.jam) flow.link(s.key, key, 6)
      addClock()
      return
    }

    const front = cfg.balancer ? keys.lb : cfg.apps[0]
    if (cfg.balancer) {
      flow.add(new Router(keys.lb)).algorithm = 'least-connections'
    }
    for (const key of cfg.apps) {
      flow.add(new App(key, this))
      if (cfg.balancer) flow.link(keys.lb, key, 4)
    }
    // Where the three kinds of request first go.
    const door = cfg.gate ? keys.gate : front
    if (cfg.gate) {
      flow.add(new Gate(keys.gate, cfg.gate.limit, cfg.gate.scope))
      flow.link(keys.gate, front, 4)
    }
    for (const s of sources) flow.link(s.key, door, 6)

    for (const key of cfg.replicas) {
      const r = flow.add(new Worker(key, { slots: 4, queueLimit: 24, workPerRequest: READ_WORK }))
      r.onFinish = (job, sim) => this.filled(job, sim)
    }
    if (cfg.cacheSize) {
      const c = (this.cache = flow.add(new ReadCache(keys.cache)))
      c.capacity = cfg.cacheSize
      c.coalesce = true
      for (const s of ['db', ...cfg.replicas]) flow.link(keys.cache, s, 5)
      // The service has been running a while: the popular links are already in memory.
      for (let k = 0; k < c.capacity; k++) c.fill(k, flow)
    }
    if (cfg.queue) {
      const fifo = flow.add(new Fifo(keys.queue, 80))
      fifo.prefetch = 10
      flow.link(keys.queue, 'db', 3)
    }
    for (const key of cfg.apps) {
      if (this.cache) flow.link(key, keys.cache, 5)
      flow.link(key, 'db', 8)
      for (const r of cfg.replicas) flow.link(key, r, 8)
      if (cfg.queue) flow.link(key, keys.queue, 5)
    }

    addClock()
  }

  load(tick: number) {
    return this.cfg.profile(tick)
  }

  private filled(job: Job, sim: FlowSim) {
    if (job.from === 'users' && job.key !== undefined) this.cache?.fill(job.key, sim)
  }

  // An app server has finished its share of a request: send it on.
  route(app: string, job: Job, sim: FlowSim) {
    if (job.from === 'users') {
      // Every redirect leaves a click behind: a database write in the way,
      // or a message on a queue for later.
      const click = sim.newJob(0, job.key, 'click')
      sim.forward(click, app, this.cfg.queue ? this.keys.queue : 'db')
      if (this.cache) return sim.forward(job, app, this.keys.cache)
      const stores = ['db', ...this.cfg.replicas]
      return sim.forward(job, app, stores[this.reads++ % stores.length])
    }
    // A create: pick a code, write it.
    const { scheme, apps } = this.cfg
    if (scheme === 'counter' && apps.length > 1 && sim.rng() < COUNTER_CLASH) this.flow.tally.dupes++
    if (scheme === 'hash' && sim.rng() < HASH_RETRY) sim.forward(sim.newJob(0, undefined, 'retry'), app, 'db')
    sim.forward(job, app, 'db')
  }

  // How much of the cache's work was answered from memory, 0 to 1.
  hitRate() {
    const c = this.cache
    if (!c || c.hits + c.misses === 0) return 0
    return c.hits / (c.hits + c.misses)
  }

  get tally() {
    return this.flow.tally
  }

  // Redirects that did not work: turned away, or too slow.
  redirectsFailed() {
    return (this.tally.failed.users ?? 0) + (this.tally.limited.users ?? 0) + this.tally.slow
  }

  // A part, named the way a learner sees it.
  nameOf(key: string) {
    if (key === 'db') return 'the database'
    if (this.cfg.apps.includes(key)) return 'an app server'
    if (this.cfg.replicas.includes(key)) return 'a read replica'
    if (key === this.keys.cache) return 'the cache'
    if (key === this.keys.queue) return 'the queue'
    if (key === this.keys.lb) return 'the balancer'
    return key
  }

  // The part that turned away the most redirects, and how many.
  lostAt() {
    const top = Object.entries(this.tally.at).sort((a, b) => b[1] - a[1])[0]
    return top ? { key: top[0], what: this.nameOf(top[0]), count: top[1] } : null
  }

  // Real people whose new link was not made.
  makersFailed() {
    return (this.tally.failed.makers ?? 0) + (this.tally.limited.makers ?? 0)
  }

  clicksLost() {
    return this.tally.failed.click ?? 0
  }
}
