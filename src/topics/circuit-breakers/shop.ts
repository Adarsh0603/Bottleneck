// Timeouts, retries and circuit breakers, on the shared flow engine. A shop
// has a few threads. Every request takes one until it is answered:
//
//   users ──▶ shop ──▶ payments   (checkout needs it)
//                └───▶ reviews    (a product page can show reviews)
//
// A browse request is quick, unless the page asks Reviews for ratings. A
// checkout always asks Payments. While a call is out, the thread waits. So a
// dependency that goes slow, or silent, ties up threads one by one until the
// shop has none left, and then even pages that need nothing from it fail.
//
// What the shop does about a call is its policy:
//   - timeout:  give up after a while, and free the thread
//   - retries:  try again, now or after a growing pause
//   - breaker:  after enough failures in a row, stop calling for a while, then
//               let one call through to see whether it is back
//   - bulkhead: let one dependency hold only so many threads
//   - fallback: when optional Reviews fail, show the page without them

import { FlowSim, type FlowNode, type Job } from '../../core/flow/engine'
import { Worker } from '../../core/flow/nodes'
import type { BreakerState } from '../../core/build/pieces'

export const TICKS_PER_SECOND = 20
export const SECOND = TICKS_PER_SECOND

export type Dep = 'pay' | 'rev'
export type Mode = 'ok' | 'slow' | 'mixed' | 'blip' | 'outage' | 'down'
export type Backoff = 'none' | 'exp' | 'jitter'
export type Kind = 'browse' | 'checkout'
export const KINDS: Kind[] = ['browse', 'checkout']
export const DEPS: Dep[] = ['pay', 'rev']
export const DEP_NAMES: Record<Dep, string> = { pay: 'Payments', rev: 'Reviews' }
export const MODE_NAMES: Record<Mode, string> = {
  ok: 'Healthy',
  slow: 'Very slow',
  mixed: 'Sometimes stuck',
  blip: 'Blips',
  outage: 'Goes down for a while',
  down: 'Down',
}

export const THREADS = [6, 8, 12, 16, 24] // the thread counts a learner can pick
export const TIMEOUTS = [0.25, 0.5, 1, 2, 4, 0] // seconds; 0 waits as long as it takes
export const TRIPS = [2, 3, 5, 10] // failures in a row that open the breaker
export const COOLDOWNS = [1, 3, 6, 10] // seconds the breaker stays open
export const POOLS = [0, 1, 2, 3, 4] // threads one dependency may hold; 0 is no limit

export const BROWSE_RATE = 4 // a second
export const CHECKOUT_RATE = 3
const LOCAL = 2 // ticks of the shop's own work
export const LINK = 2 // ticks to reach a dependency (and the answer is as quick)
const QUEUE = 4 // requests that may wait for a thread
export const PATIENCE = 3 * SECOND // a user waits this long for an answer
const CAP: Record<Dep, number> = { pay: 5, rev: 8 } // calls a second a dependency can take
const SERVICE = { fast: 4, mid: 8, slow: 100 } // ticks a dependency takes
export const BLIP_EVERY = 5 * SECOND
const BLIP_AT = 1 * SECOND
const BLIP_LENGTH = 1.5 * SECOND
export const OUTAGE_EVERY = 20 * SECOND
export const OUTAGE_AT = 5 * SECOND
export const OUTAGE_LENGTH = 7 * SECOND
const BACKOFF_BASE = 0.5 * SECOND

export interface Config {
  pay: Mode
  rev: Mode
  reviews: boolean // a product page asks Reviews
  timeout: number // seconds; 0 waits as long as it takes
  retries: number
  backoff: Backoff
  breaker: Record<Dep, boolean>
  trip: number
  cooldown: number // seconds
  fallback: boolean // a page can do without reviews
  pool: number // threads one dependency may hold; 0 is no limit
  threads: number
  // Changes how a dependency behaves as the run goes on, when the task has a script.
  script?: (dep: Dep, tick: number) => Mode | undefined
}

export const DEFAULTS: Config = {
  pay: 'ok',
  rev: 'ok',
  reviews: false,
  timeout: 0,
  retries: 0,
  backoff: 'none',
  breaker: { pay: false, rev: false },
  trip: 5,
  cooldown: 3,
  fallback: false,
  pool: 0,
  threads: 6,
}

export type Outcome = 'ok' | 'degraded' | 'failed'
const OUTCOMES: Outcome[] = ['ok', 'degraded', 'failed']

// Is the dependency really working at this moment?
export function healthy(mode: Mode, tick: number): boolean {
  if (mode === 'ok') return true
  if (mode === 'blip') return tick % BLIP_EVERY < BLIP_AT || tick % BLIP_EVERY >= BLIP_AT + BLIP_LENGTH
  if (mode === 'outage') return tick % OUTAGE_EVERY < OUTAGE_AT || tick % OUTAGE_EVERY >= OUTAGE_AT + OUTAGE_LENGTH
  return false
}

// Is the dependency not answering at all at this moment?
export function isDown(mode: Mode, tick: number): boolean {
  return mode === 'down' || (mode === 'outage' && !healthy('outage', tick))
}

export interface Tally {
  sent: Record<Kind, number>
  ok: Record<Kind, number>
  degraded: Record<Kind, number>
  failed: Record<Kind, number>
  gaveUp: Record<Kind, number> // the user stopped waiting
  turnedAway: number // the shop had no thread and no room to wait
  shed: Record<Dep, number> // failed at once: breaker open or pool full
  timeouts: Record<Dep, number>
  retried: Record<Dep, number>
  needless: number // checkouts that failed while Payments was answering, so a better policy could have saved them
  limited: number // turned away by a rate limiter at the door
  waited: number // ticks users waited for the answers that worked
  answered: number
}

const both = <T>(v: () => T): Record<Kind, T> => ({ browse: v(), checkout: v() })
const perDep = <T>(v: () => T): Record<Dep, T> => ({ pay: v(), rev: v() })
const emptyTally = (): Tally => ({
  sent: both(() => 0),
  ok: both(() => 0),
  degraded: both(() => 0),
  failed: both(() => 0),
  gaveUp: both(() => 0),
  turnedAway: 0,
  shed: perDep(() => 0),
  timeouts: perDep(() => 0),
  retried: perDep(() => 0),
  needless: 0,
  limited: 0,
  waited: 0,
  answered: 0,
})

// Closed: calls go through. Open: calls fail at once. Half open: one call is
// let through to find out whether the dependency is back.
export type { BreakerState }

export class Breaker {
  state: BreakerState = 'closed'
  fails = 0
  openedAt = 0
  probing = false

  allow(tick: number, cooldown: number): boolean {
    if (this.state === 'closed') return true
    if (this.state === 'open') {
      if (tick - this.openedAt < cooldown * SECOND) return false
      this.state = 'half'
    }
    if (this.probing) return false
    this.probing = true
    return true
  }

  record(ok: boolean, tick: number, trip: number) {
    if (ok) {
      if (this.state === 'half') this.state = 'closed'
      if (this.state === 'closed') this.fails = 0
      this.probing = false
      return
    }
    if (this.state === 'half') {
      this.probing = false
      this.open(tick)
    } else if (this.state === 'closed' && ++this.fails >= trip) this.open(tick)
  }

  // Seconds until a probe is let through, while open.
  waitLeft(tick: number, cooldown: number): number {
    return this.state === 'open' ? Math.max(0, cooldown - (tick - this.openedAt) / SECOND) : 0
  }

  reset() {
    this.state = 'closed'
    this.fails = 0
    this.probing = false
  }

  private open(tick: number) {
    this.state = 'open'
    this.openedAt = tick
    this.fails = 0
  }
}

// The dependencies answer after a while, with an answer that worked or one
// that did not. A dependency that is down never answers.
export class Dependency extends Worker {
  readonly dep: Dep
  calls = 0
  overloaded = 0
  private world: Shop
  private due: { at: number; id: number; ok: boolean; job: Job }[] = []
  private recent: number[] = []
  private credit: number

  constructor(dep: Dep, world: Shop) {
    super(dep, { slots: 4, queueLimit: 99 })
    this.dep = dep
    this.world = world
    this.credit = CAP[dep] / 2
  }

  receive(job: Job, sim: FlowSim) {
    const tick = sim.tick
    this.calls++
    this.recent.push(tick)
    if (this.credit < 1) {
      this.overloaded++
      return this.answer(job, sim, false, 1)
    }
    this.credit--
    const mode = this.world.modeOf(this.dep, tick)
    if (mode === 'ok') return this.answer(job, sim, true, SERVICE.fast)
    if (mode === 'slow') return this.answer(job, sim, true, SERVICE.slow)
    if (mode === 'mixed') return this.answer(job, sim, true, this.calls % 4 === 0 ? SERVICE.slow : SERVICE.mid)
    if (mode === 'blip') return healthy('blip', tick) ? this.answer(job, sim, true, SERVICE.fast) : this.answer(job, sim, false, 1)
    if (mode === 'outage' && healthy('outage', tick)) return this.answer(job, sim, true, SERVICE.fast)
    // Down: the call is never answered, and nothing of ours is tied up.
  }

  private answer(job: Job, sim: FlowSim, ok: boolean, ticks: number) {
    this.due.push({ at: sim.tick + ticks, id: job.key ?? 0, ok, job })
    this.active.push(job)
  }

  // Driven by the clock, so a dependency that is down still sends the answers it owed.
  step(sim: FlowSim) {
    const tick = sim.tick
    this.credit = Math.min(CAP[this.dep] / 2, this.credit + CAP[this.dep] / SECOND)
    this.recent = this.recent.filter((t) => t > tick - SECOND)
    const left: typeof this.due = []
    for (const d of this.due) {
      if (d.at > tick) {
        left.push(d)
        continue
      }
      this.active = this.active.filter((j) => j !== d.job)
      this.world.reply(d.id, d.ok, sim)
    }
    this.due = left
    this.alive = !isDown(this.world.modeOf(this.dep, tick), tick)
  }

  process() {}

  // Calls arriving in the last second.
  get rate(): number {
    return this.recent.length
  }

  get capacity(): number {
    return CAP[this.dep]
  }

  load() {
    return this.due.length
  }

  lose() {
    this.due = []
    this.active = []
    return []
  }
}

// A stand-in on the way to a dependency, where a breaker or a cache stands.
// It hands the call on; the shop does the deciding.
export class Gate implements FlowNode {
  alive = true
  readonly key: string
  readonly dep: Dep
  private world: Shop

  constructor(key: string, dep: Dep, world: Shop) {
    this.key = key
    this.dep = dep
    this.world = world
  }

  get state(): BreakerState {
    return this.world.breakers[this.dep].state
  }

  receive(job: Job, sim: FlowSim) {
    sim.forward(job, this.key, this.dep)
  }
}

interface Req {
  job: Job
  kind: Kind
  dep?: Dep
  attempt: number
  state: 'local' | 'wait' | 'backoff'
  until: number
  since: number // when this wait began
  call: number
  fallbackUsed: boolean
}

// The shop: a pool of threads in front of its dependencies.
export class ShopNode extends Worker {
  private world: Shop

  constructor(world: Shop) {
    super('shop', { slots: world.cfg.threads, queueLimit: QUEUE })
    this.world = world
  }

  receive(job: Job, sim: FlowSim) {
    this.world.admit(job, sim)
  }

  process(sim: FlowSim) {
    this.world.work(sim)
  }

  load() {
    return this.active.length + this.queue.length
  }

  lose() {
    return []
  }
}

class Users implements FlowNode {
  alive = true
  readonly key = 'users'
  private world: Shop
  private carry: Record<Kind, number> = { browse: 0, checkout: 0 }
  pending = new Map<number, { kind: Kind; sent: number }>()

  constructor(world: Shop) {
    this.world = world
  }

  emit(sim: FlowSim) {
    const rates: Record<Kind, number> = { browse: BROWSE_RATE, checkout: CHECKOUT_RATE }
    KINDS.forEach((kind, k) => {
      this.carry[kind] += rates[kind] / SECOND
      while (this.carry[kind] >= 1) {
        this.carry[kind]--
        const job = sim.newJob(0, k, 'users')
        this.world.tally.sent[kind]++
        this.pending.set(job.id, { kind, sent: sim.tick })
        sim.forward(job, 'users', this.world.userDoor)
      }
    })
  }

  // An answer reaches the user: how it went is in `job.work`.
  receive(job: Job, sim: FlowSim) {
    const p = this.pending.get(job.id)
    if (!p) return
    this.pending.delete(job.id)
    const t = this.world.tally
    const outcome = OUTCOMES[job.work]
    if (sim.tick - p.sent >= PATIENCE) {
      t.gaveUp[p.kind]++
      t.failed[p.kind]++
      return
    }
    t[outcome][p.kind]++
    if (outcome !== 'failed') {
      t.waited += sim.tick - p.sent
      t.answered++
    } else if (p.kind === 'checkout' && !isDown(this.world.modeOf('pay', sim.tick), sim.tick)) t.needless++
  }

  // Users who gave up waiting.
  process(sim: FlowSim) {
    for (const [id, p] of this.pending) {
      if (sim.tick - p.sent < PATIENCE) continue
      this.pending.delete(id)
      this.world.tally.gaveUp[p.kind]++
      this.world.tally.failed[p.kind]++
      if (p.kind === 'checkout' && !isDown(this.world.modeOf('pay', sim.tick), sim.tick)) this.world.tally.needless++
    }
  }
}

// A rate limiter at the door. It turns away what it has no room for, whoever sent it.
const LIMIT_RATE = 5 // requests a second

class Limit implements FlowNode {
  alive = true
  readonly key: string
  private credit = 2
  private world: Shop

  constructor(key: string, world: Shop) {
    this.key = key
    this.world = world
  }

  receive(job: Job, sim: FlowSim) {
    if (this.credit < 1) {
      this.world.tally.limited++
      job.work = OUTCOMES.indexOf('failed')
      sim.drop(job, this.key)
      return sim.forward(job, this.key, 'users')
    }
    this.credit--
    sim.forward(job, this.key, 'shop')
  }

  process() {
    this.credit = Math.min(2, this.credit + LIMIT_RATE / SECOND)
  }
}

// A piece that stands by the shop and takes no part in a request's journey.
class Idle implements FlowNode {
  alive = true
  readonly key: string

  constructor(key: string) {
    this.key = key
  }

  receive() {}
}

// Runs what happens every tick in the dependencies, after the shop's work.
class Clock implements FlowNode {
  alive = true
  readonly key = 'clock'
  private world: Shop

  constructor(world: Shop) {
    this.world = world
  }

  receive() {}

  process(sim: FlowSim) {
    for (const dep of DEPS) this.world.deps[dep].step(sim)
  }
}

export interface Options {
  // Each dependency's front door: a node the call passes through on the way.
  gates?: Partial<Record<Dep, string>>
  // A rate limiter that every customer request passes through first.
  front?: string
  // Pieces that stand by the shop and do nothing on the road.
  idle?: string[]
}

export class Shop {
  readonly flow: FlowSim
  readonly cfg: Config
  readonly shop: ShopNode
  readonly deps: Record<Dep, Dependency>
  readonly breakers: Record<Dep, Breaker> = { pay: new Breaker(), rev: new Breaker() }
  readonly gates: Gate[] = []
  tally = emptyTally()
  since = 0 // the tick the numbers started from
  private users: Users
  private reqs = new Map<number, Req>() // by user request id
  private calls = new Map<number, Req>() // by call id
  private inflight: Record<Dep, number> = { pay: 0, rev: 0 }
  private nextCall = 1
  private signature = ''
  private door: Record<Dep, string>
  readonly userDoor: string

  constructor(rng: () => number = Math.random, opts: Options = {}) {
    this.flow = new FlowSim(rng)
    this.cfg = { ...DEFAULTS, breaker: { ...DEFAULTS.breaker } }
    this.users = this.flow.add(new Users(this))
    this.shop = this.flow.add(new ShopNode(this))
    this.deps = { pay: this.flow.add(new Dependency('pay', this)), rev: this.flow.add(new Dependency('rev', this)) }
    this.door = { pay: opts.gates?.pay ?? 'pay', rev: opts.gates?.rev ?? 'rev' }
    for (const dep of DEPS) {
      const key = opts.gates?.[dep]
      if (key) {
        const gate = this.flow.add(new Gate(key, dep, this))
        this.gates.push(gate)
        this.flow.link('shop', key, LINK)
        this.flow.link(key, dep, 0)
      } else this.flow.link('shop', dep, LINK)
    }
    this.userDoor = opts.front ?? 'shop'
    if (opts.front) {
      this.flow.add(new Limit(opts.front, this))
      this.flow.link('users', opts.front, LINK)
      this.flow.link(opts.front, 'shop', 0)
    } else this.flow.link('users', 'shop', LINK)
    for (const key of opts.idle ?? []) {
      this.flow.add(new Idle(key))
      this.flow.link('shop', key, LINK)
    }
    this.flow.add(new Clock(this))
    this.configure({})
  }

  modeOf(dep: Dep, tick: number): Mode {
    return this.cfg.script?.(dep, tick) ?? this.cfg[dep]
  }

  get tick() {
    return this.flow.tick
  }

  // --- A request comes in ---------------------------------------------------

  admit(job: Job, sim: FlowSim) {
    const kind = KINDS[job.key ?? 0]
    const req: Req = { job, kind, attempt: 0, state: 'local', until: 0, since: sim.tick, call: 0, fallbackUsed: false }
    if (this.shop.active.length < this.cfg.threads) return this.start(req, sim)
    if (this.shop.queue.length < QUEUE) {
      this.shop.queue.push(job)
      this.reqs.set(job.id, req)
      return
    }
    this.tally.turnedAway++
    this.finish(req, 'failed', sim)
  }

  private start(req: Req, sim: FlowSim) {
    req.state = 'local'
    req.until = sim.tick + LOCAL
    req.dep = req.kind === 'checkout' ? 'pay' : this.cfg.reviews ? 'rev' : undefined
    this.reqs.set(req.job.id, req)
    this.shop.active.push(req.job)
  }

  // --- The thread's work, a tick at a time ---------------------------------

  work(sim: FlowSim) {
    const tick = sim.tick
    for (const job of [...this.shop.active]) {
      const req = this.reqs.get(job.id)
      if (!req) continue
      if (req.state === 'wait') {
        if (req.until <= tick) this.timedOut(req, sim)
      } else if (req.until <= tick) {
        if (!req.dep) this.finish(req, 'ok', sim)
        else this.attempt(req, sim)
      }
    }
    this.fill(sim)
  }

  // Free threads take the next requests in line, skipping any whose user has gone.
  private fill(sim: FlowSim) {
    while (this.shop.active.length < this.cfg.threads && this.shop.queue.length > 0) {
      const job = this.shop.queue.shift()!
      const req = this.reqs.get(job.id)
      if (!req) continue
      if (!this.users.pending.has(job.id)) {
        this.reqs.delete(job.id)
        continue
      }
      this.start(req, sim)
    }
  }

  private attempt(req: Req, sim: FlowSim) {
    const dep = req.dep!
    const { cfg } = this
    const breaker = this.breakers[dep]
    if (req.attempt > 0) this.tally.retried[dep]++
    req.attempt++
    if (cfg.breaker[dep] && !breaker.allow(sim.tick, cfg.cooldown)) return this.shed(req, sim)
    if (cfg.pool > 0 && this.inflight[dep] >= cfg.pool) return this.shed(req, sim)
    const id = this.nextCall++
    req.call = id
    req.state = 'wait'
    req.since = sim.tick
    req.until = cfg.timeout > 0 ? sim.tick + Math.round(cfg.timeout * SECOND) : Infinity
    this.calls.set(id, req)
    this.inflight[dep]++
    sim.forward(sim.newJob(1, id, 'shop'), 'shop', this.door[dep])
  }

  // An answer from a dependency.
  reply(id: number, ok: boolean, sim: FlowSim) {
    const req = this.calls.get(id)
    if (!req) return // too late: the shop stopped waiting
    this.calls.delete(id)
    const dep = req.dep!
    this.inflight[dep]--
    if (this.cfg.breaker[dep]) this.breakers[dep].record(ok, sim.tick, this.cfg.trip)
    if (ok) return this.finish(req, 'ok', sim)
    this.failed(req, sim)
  }

  private timedOut(req: Req, sim: FlowSim) {
    const dep = req.dep!
    this.calls.delete(req.call)
    this.inflight[dep]--
    this.tally.timeouts[dep]++
    if (this.cfg.breaker[dep]) this.breakers[dep].record(false, sim.tick, this.cfg.trip)
    this.failed(req, sim)
  }

  // A call failed. Try again, if the policy allows and the breaker is not open.
  private failed(req: Req, sim: FlowSim) {
    const { cfg } = this
    const dep = req.dep!
    if (req.attempt <= cfg.retries && !(cfg.breaker[dep] && this.breakers[dep].state === 'open')) {
      const n = req.attempt - 1
      const base = cfg.backoff === 'none' ? 1 : BACKOFF_BASE * 2 ** n
      const wait = cfg.backoff === 'jitter' ? base * (0.5 + sim.rng()) : base
      req.state = 'backoff'
      req.until = sim.tick + Math.max(1, Math.round(wait))
      return
    }
    this.concede(req, sim)
  }

  // Nothing more to try: carry on without it, or fail.
  private concede(req: Req, sim: FlowSim) {
    if (req.dep === 'rev' && this.cfg.fallback) return this.finish(req, 'degraded', sim)
    this.finish(req, 'failed', sim)
  }

  // Turned away at once, without a call.
  private shed(req: Req, sim: FlowSim) {
    this.tally.shed[req.dep!]++
    this.concede(req, sim)
  }

  private finish(req: Req, outcome: Outcome, sim: FlowSim) {
    this.reqs.delete(req.job.id)
    this.shop.active = this.shop.active.filter((j) => j !== req.job)
    req.job.work = OUTCOMES.indexOf(outcome)
    if (outcome === 'failed') sim.drop(req.job, 'shop')
    sim.forward(req.job, 'shop', 'users')
  }

  // --- Setup ---------------------------------------------------------------

  reset() {
    this.tally = emptyTally()
    for (const dep of DEPS) this.breakers[dep].reset()
    this.since = this.flow.tick
  }

  configure(next: Partial<Config>) {
    const { cfg } = this
    Object.assign(cfg, next)
    this.shop.slots = cfg.threads
    const signature = JSON.stringify({ ...cfg, script: cfg.script ? 1 : 0 })
    if (signature === this.signature) return
    this.signature = signature
    this.reset()
  }

  // Threads that have been waiting on a call for a good while.
  get stuck(): number {
    let n = 0
    for (const req of this.reqs.values()) if (req.state !== 'local' && this.flow.tick - req.since > SECOND && this.shop.active.includes(req.job)) n++
    return n
  }

  get waitMs(): number {
    return this.tally.answered === 0 ? 0 : (this.tally.waited / this.tally.answered) * (1000 / TICKS_PER_SECOND)
  }
}
