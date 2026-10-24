// Rate limiting, on the shared flow engine. Three clients call an API that can
// serve about 10 requests a second:
//
//   A ─┐
//   B  ─┼──▶ limiter(s) ──▶ API
//   Bot ─┘
//
// A and B are ordinary users. The bot is the trouble: it floods the API, or
// sends bursts timed to slip past a counter. The limiter decides, for each
// request, to let it through or turn it away (a 429). How it decides is the
// algorithm:
//   - fixed:   count requests in each clock second; the count resets on the dot.
//   - sliding: count requests in the last second, whatever the clock says.
//   - token:   a bucket of tokens refills at the limit; each request takes one.
//   - leaky:   requests wait in a bucket and drip out at the limit.
// Several gateways can each run a limiter; they either keep a counter apiece
// or share one.

import { FlowSim, type FlowNode, type Job } from '../../core/flow/engine'
import { Worker } from '../../core/flow/nodes'

export const TICKS_PER_SECOND = 20
export const SECOND = TICKS_PER_SECOND

export type Algo = 'fixed' | 'sliding' | 'token' | 'leaky'
export const ALGO_NAMES: Record<Algo, string> = { fixed: 'Fixed window', sliding: 'Sliding window', token: 'Token bucket', leaky: 'Leaky bucket' }
export const LIMITS = [2, 3, 4, 5, 6, 8, 10] // the limits a learner can pick, a second
export const BURSTS = [2, 4, 6, 8, 12] // the bucket sizes
export type Scope = 'client' | 'all'
export type BotMode = 'quiet' | 'flood' | 'edge'

export const CLIENTS = ['ann', 'bo', 'bot'] as const
export type Client = (typeof CLIENTS)[number]
export const CLIENT_NAMES: Record<Client, string> = { ann: 'A', bo: 'B', bot: 'Bot' }
export const MAX_GATEWAYS = 3

const API_WORK = 4 // ticks per request, so one slot serves 5 a second
const API_SLOTS = 2 // 10 a second in all
export const API_RATE = (API_SLOTS * TICKS_PER_SECOND) / API_WORK
// A request reaches a gateway 8 ticks after it is sent, with or without a
// balancer on the way, so a burst lands on the same clock tick either way.
const LINK_TICKS = { client: 8, toBalancer: 2, gate: 6, shared: 4 }
const ARRIVES = LINK_TICKS.client
const EDGE_BATCH = 6
const EDGE_EVERY = 2 * SECOND
const ANN_BURST = 4
const ANN_BURST_EVERY = 5 * SECOND
const WINDOW = 3 * SECOND

export interface Config {
  limiting: boolean // false: the gateway lets everything through
  algo: Algo
  limit: number // requests a second
  burst: number // bucket size, for token and leaky
  scope: Scope // one count per client, or one for everyone
  bot: BotMode
  annBursts: boolean // A loads a page: several requests at once
  gateways: number
  shared: boolean // gateways share one counter
  apiQueue: number // requests the API will let wait
  capacity: number // decisions a second one gateway can make
  // Changes the bot's mode as the run goes on, when the task has a script.
  script?: (tick: number) => BotMode
}

export const DEFAULTS: Config = {
  limiting: true,
  algo: 'fixed',
  limit: 4,
  burst: 4,
  scope: 'client',
  bot: 'quiet',
  annBursts: false,
  gateways: 1,
  shared: true,
  apiQueue: 6,
  capacity: Infinity,
}

export interface Tally {
  sent: Record<Client, number>
  allowed: Record<Client, number>
  rejected: Record<Client, number> // turned away by a limit (429)
  busy: Record<Client, number> // turned away because a gateway could not keep up (503)
  served: Record<Client, number>
  overload: number // the API had no room
  waited: number // ticks requests spent in a leaky bucket
  held: number // how many of those there were
}

const each = <T>(v: () => T): Record<Client, T> => ({ ann: v(), bo: v(), bot: v() })
const emptyTally = (): Tally => ({
  sent: each(() => 0),
  allowed: each(() => 0),
  rejected: each(() => 0),
  busy: each(() => 0),
  served: each(() => 0),
  overload: 0,
  waited: 0,
  held: 0,
})

// What a limiter remembers. Gateways that share a counter share one of these.
export class Counters {
  fixed = new Map<number, { window: number; count: number }>()
  log = new Map<number, number[]>()
  tokens = new Map<number, { n: number; at: number }>()
  lanes = new Map<number, { jobs: { job: Job; at: number }[]; drip: number }>()

  clear() {
    this.fixed.clear()
    this.log.clear()
    this.tokens.clear()
    this.lanes.clear()
  }
}

// One client, sending on its own pattern.
class ClientNode implements FlowNode {
  alive = true
  readonly key: string
  readonly id: number
  private world: Gateway
  private turn = 0

  constructor(id: number, world: Gateway) {
    this.id = id
    this.key = CLIENTS[id]
    this.world = world
  }

  receive(job: Job, sim: FlowSim) {
    sim.complete(job)
  }

  emit(sim: FlowSim) {
    const n = this.world.sends(this.id, sim.tick)
    for (let i = 0; i < n; i++) {
      const job = sim.newJob(1, this.id, this.key)
      this.world.tally.sent[CLIENTS[this.id]]++
      const targets = sim.targets(this.key)
      const to = targets[this.turn++ % Math.max(1, targets.length)]
      if (to) sim.forward(job, this.key, to.key)
      else sim.drop(job, this.key)
    }
  }
}

// The thing under protection. It turns away what it has no room for.
class Api extends Worker {
  private world: Gateway

  constructor(world: Gateway) {
    super('api', { slots: API_SLOTS, queueLimit: world.cfg.apiQueue, workPerRequest: API_WORK })
    this.world = world
    this.onFinish = (job) => {
      world.tally.served[CLIENTS[job.key ?? 0]]++
    }
  }

  receive(job: Job, sim: FlowSim) {
    this.queueLimit = this.world.cfg.apiQueue
    if (this.queue.length >= this.queueLimit) this.world.tally.overload++
    super.receive(job, sim)
  }
}

// A gateway's rate limiter.
export class Limiter implements FlowNode {
  alive = true
  private credit = 3
  readonly own = new Counters()
  // The counters gateways share, when they do.
  common: Counters | null = null

  readonly key: string
  private world: Gateway

  constructor(key: string, world: Gateway) {
    this.key = key
    this.world = world
  }

  get counters() {
    return this.common ?? this.own
  }

  receive(job: Job, sim: FlowSim) {
    const { cfg } = this.world
    const client = CLIENTS[job.key ?? 0]
    if (Number.isFinite(cfg.capacity)) {
      if (this.credit < 1) {
        this.world.tally.busy[client]++
        return sim.drop(job, this.key)
      }
      this.credit--
    }
    if (!cfg.limiting) return this.pass(job, sim)
    const k = cfg.scope === 'client' ? (job.key ?? 0) : 0
    const c = this.counters
    const tick = sim.tick

    if (cfg.algo === 'fixed') {
      const window = Math.floor(tick / SECOND)
      let s = c.fixed.get(k)
      if (!s || s.window !== window) c.fixed.set(k, (s = { window, count: 0 }))
      if (s.count >= cfg.limit) return this.reject(job, sim)
      s.count++
      return this.pass(job, sim)
    }

    if (cfg.algo === 'sliding') {
      const log = (c.log.get(k) ?? []).filter((t) => t > tick - SECOND)
      c.log.set(k, log)
      if (log.length >= cfg.limit) return this.reject(job, sim)
      log.push(tick)
      return this.pass(job, sim)
    }

    if (cfg.algo === 'token') {
      const s = c.tokens.get(k) ?? { n: cfg.burst, at: tick }
      s.n = Math.min(cfg.burst, s.n + ((tick - s.at) * cfg.limit) / SECOND)
      s.at = tick
      c.tokens.set(k, s)
      if (s.n < 1) return this.reject(job, sim)
      s.n--
      return this.pass(job, sim)
    }

    // Leaky: wait in the bucket, and leave at the limit.
    const lane = c.lanes.get(k) ?? { jobs: [], drip: 1 }
    c.lanes.set(k, lane)
    if (lane.jobs.length >= cfg.burst) return this.reject(job, sim)
    lane.jobs.push({ job, at: tick })
  }

  process(sim: FlowSim) {
    const { cfg } = this.world
    if (Number.isFinite(cfg.capacity)) this.credit = Math.min(3, this.credit + cfg.capacity / SECOND)
    if (cfg.algo !== 'leaky' || !cfg.limiting) return
    for (const lane of this.counters.lanes.values()) {
      lane.drip += cfg.limit / SECOND
      while (lane.drip >= 1 && lane.jobs.length > 0) {
        lane.drip--
        const { job, at } = lane.jobs.shift()!
        this.world.tally.waited += sim.tick - at
        this.world.tally.held++
        this.pass(job, sim)
      }
      if (lane.jobs.length === 0) lane.drip = Math.min(lane.drip, 1)
    }
  }

  load() {
    return this.held().length
  }

  // Requests waiting in a leaky bucket, oldest first in each lane.
  held(): Job[] {
    return [...this.counters.lanes.values()].flatMap((lane) => lane.jobs.map((j) => j.job))
  }

  private pass(job: Job, sim: FlowSim) {
    this.world.tally.allowed[CLIENTS[job.key ?? 0]]++
    sim.forward(job, this.key, 'api')
  }

  private reject(job: Job, sim: FlowSim) {
    this.world.tally.rejected[CLIENTS[job.key ?? 0]]++
    sim.drop(job, this.key)
  }
}

// Sends each request to one of the gateways, in turn. A build places this
// itself; the lessons let clients take turns without it.
class Balancer implements FlowNode {
  alive = true
  readonly key = 'lb'
  private turn = 0

  receive(job: Job, sim: FlowSim) {
    const targets = sim.targets(this.key)
    const to = targets[this.turn++ % Math.max(1, targets.length)]
    if (to) sim.forward(job, this.key, to.key)
    else sim.drop(job, this.key)
  }
}

export interface Options {
  gates?: string[] // gateway keys; each gets a limiter. Otherwise `cfg.gateways` decide.
  balancer?: boolean // clients go through a balancer node
}

export class Gateway {
  readonly flow: FlowSim
  readonly cfg: Config
  readonly gates: Limiter[] = []
  readonly api: Api
  tally = emptyTally()
  private common = new Counters()
  private manual: boolean
  private balanced: boolean
  private signature = ''
  private history: { allowed: Record<Client, number>; overload: number; dropped: number; completed: number }[] = []
  private carry = 0
  since = 0 // the tick the numbers started from

  constructor(rng: () => number = Math.random, opts: Options = {}) {
    this.flow = new FlowSim(rng)
    this.cfg = { ...DEFAULTS }
    this.manual = !!opts.gates
    this.balanced = !!opts.balancer
    for (let i = 0; i < CLIENTS.length; i++) this.flow.add(new ClientNode(i, this))
    this.api = this.flow.add(new Api(this))
    const keys = opts.gates ?? Array.from({ length: MAX_GATEWAYS }, (_, i) => `gate-${i}`)
    for (const key of keys) this.gates.push(this.flow.add(new Limiter(key, this)))
    for (const g of this.gates) this.flow.link(g.key, 'api', LINK_TICKS.gate)
    if (this.balanced) {
      this.flow.add(new Balancer())
      for (const g of this.gates) this.flow.link('lb', g.key, LINK_TICKS.gate)
      if (this.gates.length === 0) this.flow.link('lb', 'api', 0)
    }
    // Without a balancer in a build, every client talks to the first gateway
    // only. With no gateway at all, they talk to the API.
    const front = this.balanced ? ['lb'] : this.manual ? (this.gates.length > 0 ? [this.gates[0].key] : ['api']) : this.gates.map((g) => g.key)
    for (const c of CLIENTS) for (const to of front) this.flow.link(c, to, this.balanced ? LINK_TICKS.toBalancer : LINK_TICKS.client)
    this.flow.add(new Clock(this))
    this.configure({})
  }

  // Requests a client sends this tick.
  sends(id: number, tick: number): number {
    const { cfg } = this
    if (id === 0) {
      if (!cfg.annBursts) return tick % 10 === 0 ? 1 : 0
      return (tick % SECOND === 0 ? 1 : 0) + (tick % ANN_BURST_EVERY === ANN_BURST_EVERY / 2 ? ANN_BURST : 0)
    }
    if (id === 1) return tick % 10 === 5 ? 1 : 0
    const bot = cfg.script ? cfg.script(tick) : cfg.bot
    if (bot === 'flood') {
      this.carry += 0.75
      const n = Math.floor(this.carry)
      this.carry -= n
      return n
    }
    // One batch just before a clock second ends, the next just after it begins.
    if (bot === 'edge') return tick % EDGE_EVERY === SECOND - 1 - ARRIVES || tick % EDGE_EVERY === SECOND + 1 - ARRIVES ? EDGE_BATCH : 0
    return tick % 10 === 3 ? 1 : 0
  }

  // Gateways running right now.
  get active(): Limiter[] {
    return this.manual ? this.gates : this.gates.slice(0, this.cfg.gateways)
  }

  reset() {
    this.tally = emptyTally()
    this.history = []
    this.common.clear()
    for (const g of this.gates) g.own.clear()
    this.carry = 0
    this.since = this.flow.tick
  }

  // Change the setup. Counting starts again whenever it changes in a way that
  // changes the outcome.
  configure(next: Partial<Config>) {
    const { cfg } = this
    Object.assign(cfg, next)
    const many = this.active.length > 1
    for (const g of this.gates) {
      g.common = cfg.shared ? this.common : null
      this.flow.link(g.key, 'api', LINK_TICKS.gate + (cfg.shared && many ? LINK_TICKS.shared : 0))
      if (this.manual) continue
      const on = this.active.includes(g)
      g.alive = on
      for (const c of CLIENTS) {
        this.flow.unlink(c, g.key)
        if (on) this.flow.link(c, g.key, LINK_TICKS.client)
      }
    }

    const signature = JSON.stringify({ ...cfg, script: cfg.script ? 1 : 0 })
    if (signature === this.signature) return
    this.signature = signature
    this.reset()
  }

  sample() {
    this.history.push({
      allowed: { ...this.tally.allowed },
      overload: this.tally.overload,
      dropped: this.flow.stats.dropped,
      completed: this.flow.stats.completed,
    })
    if (this.history.length > WINDOW + 1) this.history.shift()
  }

  // Requests a client got through the limiter each second, lately.
  rateOf(client: Client): number {
    const h = this.history
    if (h.length < 2) return 0
    return ((h[h.length - 1].allowed[client] - h[0].allowed[client]) * TICKS_PER_SECOND) / (h.length - 1)
  }

  // Requests the API had no room for, in the last few seconds.
  get recentOverload(): number {
    const h = this.history
    return h.length < 2 ? 0 : h[h.length - 1].overload - h[0].overload
  }

  // Requests waiting in the limiters' buckets.
  get waiting(): number {
    return this.gates.reduce((n, g) => n + g.load(), 0)
  }

  // How long a request waited in a leaky bucket, in ms, on average.
  get waitMs(): number {
    return this.tally.held === 0 ? 0 : (this.tally.waited / this.tally.held) * (1000 / TICKS_PER_SECOND)
  }
}

// Runs the limiter bookkeeping that happens every tick, after the work.
class Clock implements FlowNode {
  alive = true
  readonly key = 'clock'
  private world: Gateway

  constructor(world: Gateway) {
    this.world = world
  }

  receive() {}

  process() {
    this.world.sample()
  }
}
