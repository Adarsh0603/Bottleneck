import { FlowSim, type FlowNode, type Job } from '../../core/flow/engine'
import { SECOND, TICKS_PER_SECOND } from '../../core/flow/time'
import { Jam, Net, TokenBucket } from '../../core/flow/parts'

// A checkout, as a running system. Every order is one or more clicks on Pay:
//   shoppers → (limiter) → checkout → road → provider, which charges the card
//   checkout → ledger, which writes the order down once the charge went through
// The road between checkout and provider can hold an idempotency store, a circuit breaker
// and a limiter. A queue behind checkout can hold orders the provider cannot take right now.
// The pieces are all optional, so a bad design shows how it fails: charged twice, charged
// with no order, or no checkout at all.

export { SECOND, TICKS_PER_SECOND }

const SLOTS = 16 // calls checkout can have open at once
const LINE = 20 // clicks that may wait for a free slot
const LATENCY = 3 // ticks the provider needs for a charge, plus up to 2 more
const RETURN = 2 // ticks between a charge being made and its answer coming back
const SLOW = 100 // ticks a charge takes while the provider is slow
const LEDGER = 3 // ticks to write an order down
const PAUSE = 6 // ticks before a retry
const COOLDOWN = 3 * SECOND // a tripped breaker waits this long before it tests the road
const TRIP = 5 // failures in a row that trip a breaker
const DRAIN = 2 // ticks between orders leaving the queue
const QUEUE_CAP = 300
const SPARE = 3 // slots the queue leaves free for shoppers
export const STUCK = 3 * SECOND // money taken with nothing to show for it for this long counts as lost
export const LATE = 60 * SECOND // an order not charged after this long counts as stuck

export interface Phase {
  from: number // tick
  orders: number // per second
  clicks?: number // extra clicks every order gets, in place of the usual share
}

export interface Events {
  slow?: [number, number] // ticks: the provider takes seconds to answer
  down?: [number, number] // ticks: every call fails at once
  lost?: { from: number; to: number; rate: number } // charges that go through but whose answer is lost
  crash?: { at: number; down: number } // checkout dies and comes back
}

export type LaneKind = 'dedupe' | 'breaker' | 'limiter' | 'jam'

export interface Config {
  front: { key: string; kind: 'limiter' | 'jam'; rate?: number }[] // what stands in front of checkout
  lane: { key: string; kind: LaneKind; rate?: number }[] // what stands on the road to the provider, in order
  queue?: string
  jam?: string[]
  key: 0 | 1 | 2 // the idempotency key is new for every try, for every click, or one for the whole order
  timeout: number // ticks checkout waits for a charge
  tries: number // sends of one charge, retries included
  crash: 0 | 1 | 2 // nothing kept, order written down first, or charges with no order refunded
  dupes: number // share of orders whose Pay is clicked twice
  errRate: number // share of charges the provider refuses
  lostRate: number // share of charges that go through with the answer lost
  phases: Phase[]
  events: Events
}

export interface Order {
  id: number
  at: number
  state: 'open' | 'saved' | 'failed'
  charges: number // times the card was charged
  refunds: number
  chargedAt: number
  live: number // works in checkout for this order
  queued: boolean
  recover: boolean // waits for checkout to come back and finish it
  intent: boolean // checkout wrote it down before charging
  saving: boolean // a write to the ledger is on its way
  bad: number // charges the provider refused or lost the answer to
}

interface Work {
  order: Order
  job?: Job // the click it answers, none for an order that came out of the queue or a recovery
  step: 'charge' | 'pause' | 'save'
  call: number // id of the charge or save in flight
  due: number // tick the charge times out, or the pause ends
  tries: number
  max: number
  idem: number // the idempotency key, unless a new one is made for every try
  fromQueue: boolean
}

// Where requests start: shoppers pressing Pay.
class Shoppers implements FlowNode {
  alive = true
  readonly key = 'shoppers'
  private pay: Pay
  private due = 0
  constructor(pay: Pay) {
    this.pay = pay
  }
  receive() {}
  emit(sim: FlowSim) {
    const pay = this.pay
    const phase = pay.phaseAt(sim.tick)
    if (phase) this.due += phase.orders / SECOND
    for (; this.due >= 1; this.due--) pay.newOrder(sim, phase!)
    pay.tick(sim)
  }
}

// Lets only so many requests a second through. In front of checkout it turns shoppers away;
// on the road it makes a charge fail.
class Cap implements FlowNode {
  alive = true
  readonly key: string
  private pay: Pay
  private bucket: TokenBucket
  private front: boolean
  constructor(key: string, rate: number, front: boolean, pay: Pay) {
    this.key = key
    this.bucket = new TokenBucket(rate)
    this.front = front
    this.pay = pay
  }
  receive(job: Job, sim: FlowSim) {
    if (!this.bucket.take(sim.tick)) {
      this.pay.limited++
      return this.front ? sim.drop(job, this.key) : this.pay.answer(job, false, 'limiter', sim)
    }
    if (this.front) sim.forward(job, this.key, this.pay.nextInFront(this.key))
    else this.pay.onward(job, this.key, sim)
  }
}

// Stops calling a provider that keeps failing, and tests the road now and then.
class Breaker implements FlowNode {
  alive = true
  readonly key: string
  state: 'closed' | 'open' | 'half' = 'closed'
  private fails = 0
  private openedAt = 0
  private probing = false
  private pay: Pay
  constructor(key: string, pay: Pay) {
    this.key = key
    this.pay = pay
  }
  receive(job: Job, sim: FlowSim) {
    if (this.state === 'open' && sim.tick - this.openedAt >= COOLDOWN) {
      this.state = 'half'
      this.probing = false
    }
    if (this.state === 'open' || (this.state === 'half' && this.probing)) return this.pay.answer(job, false, 'breaker', sim)
    if (this.state === 'half') this.probing = true
    this.pay.onward(job, this.key, sim)
  }
  record(ok: boolean, sim: FlowSim) {
    if (ok) {
      this.fails = 0
      this.probing = false
      if (this.state === 'half') this.state = 'closed'
    } else if (this.state !== 'open') {
      this.fails++
      this.probing = false
      if (this.state === 'half' || this.fails >= TRIP) {
        this.state = 'open'
        this.openedAt = sim.tick
        this.fails = 0
      }
    }
  }
  // True while it turns every call away, cooldown included.
  blocking(sim: FlowSim) {
    return this.state === 'open' && sim.tick - this.openedAt < COOLDOWN
  }
}

// Remembers which keys were charged. A call with a key it knows is answered here, and a second
// call with a key still in flight waits for the first.
class Dedupe implements FlowNode {
  alive = true
  readonly key: string
  done = new Set<number>()
  blocked = 0
  private inflight = new Set<number>()
  private waiting = new Map<number, Job[]>()
  private pay: Pay
  constructor(key: string, pay: Pay) {
    this.key = key
    this.pay = pay
  }
  receive(job: Job, sim: FlowSim) {
    const k = job.key!
    if (this.done.has(k)) {
      this.blocked++
      return this.pay.answer(job, true, 'dedupe', sim)
    }
    if (this.inflight.has(k)) {
      this.waiting.set(k, [...(this.waiting.get(k) ?? []), job])
      return
    }
    this.inflight.add(k)
    this.pay.onward(job, this.key, sim)
  }
  // The provider made the charge: the key is spent, and whoever waited for it is answered.
  commit(k: number, sim: FlowSim) {
    this.done.add(k)
    this.inflight.delete(k)
    this.release(k, true, sim)
  }
  // The provider answered. A refusal clears the key, so the next try goes through.
  resolve(job: Job, ok: boolean, sim: FlowSim) {
    const k = job.key!
    if (ok) return this.commit(k, sim)
    this.inflight.delete(k)
    this.release(k, false, sim)
  }
  load() {
    return this.inflight.size
  }
  private release(k: number, ok: boolean, sim: FlowSim) {
    const w = this.waiting.get(k)
    if (!w) return
    this.waiting.delete(k)
    for (const job of w) this.pay.answer(job, ok, 'dedupe', sim)
  }
}

// The payment provider: a company we pay, which we cannot make faster or more reliable.
class Provider implements FlowNode {
  alive = true
  readonly key = 'provider'
  down = false
  slow = false
  private calls: { job: Job; execAt: number; replyAt: number; outcome: 'ok' | 'fail' | 'lost'; done: boolean }[] = []
  private pay: Pay
  constructor(pay: Pay) {
    this.pay = pay
  }
  receive(job: Job, sim: FlowSim) {
    const { errRate, lostRate, events } = this.pay.cfg
    if (this.down) return void this.calls.push({ job, execAt: Infinity, replyAt: sim.tick + 4, outcome: 'fail', done: false })
    const lost = events.lost && sim.tick >= events.lost.from && sim.tick < events.lost.to ? events.lost.rate : lostRate
    const r = sim.rng()
    // A blip passes: the third try of an order always goes through.
    const order = this.pay.orders.get(job.msg!)!
    const outcome = order.bad < 2 && r < errRate + lost ? (r < errRate ? 'fail' : 'lost') : 'ok'
    if (outcome !== 'ok') order.bad++
    const wait = this.slow ? SLOW : LATENCY + Math.floor(sim.rng() * 3)
    this.calls.push({ job, execAt: sim.tick + wait, replyAt: sim.tick + wait + RETURN, outcome, done: false })
  }
  process(sim: FlowSim) {
    const { events } = this.pay.cfg
    this.down = !!events.down && sim.tick >= events.down[0] && sim.tick < events.down[1]
    this.slow = !!events.slow && sim.tick >= events.slow[0] && sim.tick < events.slow[1]
    const later: typeof this.calls = []
    for (const c of this.calls) {
      if (!c.done && sim.tick >= c.execAt && c.outcome !== 'fail') {
        c.done = true
        this.pay.executed(c.job, sim)
      }
      if (sim.tick < c.replyAt) later.push(c)
      else if (c.outcome !== 'lost') this.pay.answer(c.job, c.outcome === 'ok', 'provider', sim)
    }
    this.calls = later
  }
  load() {
    return this.calls.length
  }
}

// Writes orders down.
class Ledger implements FlowNode {
  alive = true
  readonly key = 'ledger'
  private jobs: { job: Job; due: number }[] = []
  private pay: Pay
  constructor(pay: Pay) {
    this.pay = pay
  }
  receive(job: Job, sim: FlowSim) {
    this.jobs.push({ job, due: sim.tick + LEDGER })
  }
  process(sim: FlowSim) {
    const later: typeof this.jobs = []
    for (const j of this.jobs) {
      if (sim.tick < j.due) later.push(j)
      else this.pay.saved(j.job, sim)
    }
    this.jobs = later
  }
  load() {
    return this.jobs.length
  }
}

// Holds orders the provider cannot take right now, and sends them back to checkout when it can.
class Queue implements FlowNode {
  alive = true
  jobs: Job[] = []
  readonly key: string
  private pay: Pay
  constructor(key: string, pay: Pay) {
    this.key = key
    this.pay = pay
  }
  hold(order: Order, sim: FlowSim) {
    if (this.jobs.length >= QUEUE_CAP) return false
    const job = sim.newJob(1, undefined, 'order')
    job.msg = order.id
    order.queued = true
    this.jobs.push(job)
    return true
  }
  receive() {}
  process(sim: FlowSim) {
    if (sim.tick % DRAIN !== 0) return
    const { checkout, breaker } = this.pay
    if (!checkout.alive || checkout.spare() <= SPARE || breaker?.blocking(sim)) return
    for (let job = this.jobs.shift(); job; job = this.jobs.shift()) {
      const order = this.pay.orders.get(job.msg!)!
      if (order.state === 'open') return sim.forward(job, this.key, 'checkout')
      order.queued = false
    }
  }
  load() {
    return this.jobs.length
  }
}

// Takes each click, calls the provider, and writes the order down. Holds a slot for each call it has open.
class Checkout implements FlowNode {
  alive = true
  readonly key = 'checkout'
  works: Work[] = []
  line: Job[] = []
  recovery: Order[] = []
  private calls = new Map<number, Work>()
  private saves = new Map<number, Work>()
  private pay: Pay
  constructor(pay: Pay) {
    this.pay = pay
  }

  spare() {
    return SLOTS - this.works.length
  }

  receive(job: Job, sim: FlowSim) {
    if (!this.alive) return sim.drop(job, this.key)
    const order = this.pay.orders.get(job.msg!)!
    if (job.from === 'order') {
      order.queued = false
      order.live++
      return this.start(order, sim, undefined, 1, true)
    }
    if (this.line.length >= LINE) return sim.drop(job, this.key)
    order.live++
    this.line.push(job)
  }

  private start(order: Order, sim: FlowSim, job?: Job, max = this.pay.cfg.tries, fromQueue = false) {
    const { key, crash } = this.pay.cfg
    if (crash === 1) order.intent = true
    const idem = key === 2 ? order.id : order.id * 100 + (job?.key ?? 0)
    const work: Work = { order, job, step: 'charge', call: -1, due: 0, tries: 0, max, idem, fromQueue }
    this.works.push(work)
    this.send(work, sim)
  }

  private send(work: Work, sim: FlowSim) {
    const { key, timeout } = this.pay.cfg
    work.tries++
    work.step = 'charge'
    work.due = sim.tick + timeout
    const call = sim.newJob(1, undefined, 'charge')
    call.msg = work.order.id
    call.key = key === 0 ? 1_000_000 + call.id : work.idem
    call.caller = this.key
    work.call = call.id
    this.calls.set(call.id, work)
    sim.forward(call, this.key, this.pay.road())
  }

  // The answer to a charge: from the provider, or from a part on the road that turned it away.
  reply(job: Job, ok: boolean, who: Who, sim: FlowSim) {
    const work = this.calls.get(job.id)
    if (!work || work.step !== 'charge') return
    this.calls.delete(job.id)
    if (!ok) return this.failed(work, who === 'breaker', sim)
    work.step = 'save'
    work.order.saving = true
    const save = sim.newJob(1, undefined, 'save')
    save.msg = work.order.id
    work.call = save.id
    this.saves.set(save.id, work)
    sim.forward(save, this.key, 'ledger')
  }

  // The ledger has the order.
  finished(job: Job, sim: FlowSim) {
    const work = this.saves.get(job.id)
    if (!work) return
    this.saves.delete(job.id)
    this.end(work)
    if (work.job) sim.complete(work.job)
  }

  private end(work: Work) {
    this.works = this.works.filter((w) => w !== work)
    work.order.live--
  }

  private failed(work: Work, final: boolean, sim: FlowSim) {
    if (!final && work.tries < work.max) {
      work.step = 'pause'
      work.due = sim.tick + PAUSE
      return
    }
    this.end(work)
    const order = work.order
    if (order.state === 'saved') return void (work.job && sim.complete(work.job))
    // An order that came out of the queue goes back into it. A shopper's order goes in only when the road is shut.
    const queue = this.pay.queue
    if (queue && (final || work.fromQueue) && queue.hold(order, sim)) return void (work.job && sim.complete(work.job))
    if (work.job) sim.drop(work.job, this.key)
    else this.pay.settleFail(order)
  }

  process(sim: FlowSim) {
    while (this.recovery.length && this.works.length < SLOTS) {
      const order = this.recovery.shift()!
      order.recover = false
      if (order.state !== 'open') continue
      order.live++
      this.start(order, sim)
    }
    while (this.line.length && this.works.length < SLOTS) {
      const job = this.line.shift()!
      this.start(this.pay.orders.get(job.msg!)!, sim, job)
    }
    for (const work of [...this.works]) {
      if (work.step === 'charge' && sim.tick >= work.due) {
        this.calls.delete(work.call)
        this.pay.breaker?.record(false, sim)
        this.failed(work, false, sim)
      } else if (work.step === 'pause' && sim.tick >= work.due) this.send(work, sim)
    }
  }

  load() {
    return this.works.length + this.line.length
  }

  // Checkout died: everything it held in memory is gone.
  lose() {
    const lost: Job[] = []
    const hit = new Set<Order>()
    for (const w of this.works) {
      w.order.live--
      hit.add(w.order)
      if (w.job) lost.push(w.job)
    }
    for (const job of this.line) {
      const order = this.pay.orders.get(job.msg!)!
      order.live--
      hit.add(order)
      lost.push(job)
    }
    this.works = []
    this.line = []
    this.calls.clear()
    this.saves.clear()
    for (const order of hit) {
      this.pay.crashHit.add(order)
      if (order.state === 'open' && order.live <= 0 && !order.queued && this.pay.cfg.crash === 1 && order.intent) order.recover = true
      this.pay.settleFail(order)
    }
    return lost
  }
}

type Who = 'provider' | 'breaker' | 'limiter' | 'dedupe'

export class Pay {
  readonly flow: Net
  readonly cfg: Config
  readonly orders = new Map<number, Order>()
  limited = 0 // shoppers a limiter turned away
  readonly crashHit = new Set<Order>() // orders checkout held in memory when it crashed
  readonly checkout: Checkout
  readonly provider: Provider
  readonly ledger: Ledger
  readonly dedupe?: Dedupe
  readonly breaker?: Breaker
  readonly queue?: Queue
  private clicks: { at: number; order: Order; idx: number }[] = []
  private nextOrder = 0

  constructor(rng: () => number, cfg: Config) {
    this.cfg = cfg
    const flow = (this.flow = new Net(rng))
    flow.onLoss = (job) => this.onDrop(job)
    flow.traffic = () => this.phaseAt(flow.tick)?.orders ?? 0
    flow.add(new Shoppers(this))
    this.checkout = flow.add(new Checkout(this))
    this.provider = flow.add(new Provider(this))
    this.ledger = flow.add(new Ledger(this))
    const front = ['shoppers', ...cfg.front.map((f) => f.key), 'checkout']
    for (const f of cfg.front) flow.add(f.kind === 'jam' ? new Jam(f.key) : new Cap(f.key, f.rate ?? 10, true, this))
    front.forEach((key, i) => i > 0 && flow.link(front[i - 1], key, i === 1 ? 4 : 2))
    const road = [...cfg.lane.map((l) => l.key), 'provider']
    for (const l of cfg.lane) {
      if (l.kind === 'jam') flow.add(new Jam(l.key))
      else if (l.kind === 'dedupe') this.dedupe = flow.add(new Dedupe(l.key, this))
      else if (l.kind === 'breaker') this.breaker = flow.add(new Breaker(l.key, this))
      else flow.add(new Cap(l.key, l.rate ?? 8, false, this))
    }
    ;['checkout', ...road].forEach((key, i, all) => i > 0 && flow.link(all[i - 1], key, 2))
    flow.link('checkout', 'ledger', 2)
    if (cfg.queue) {
      this.queue = flow.add(new Queue(cfg.queue, this))
      flow.link('checkout', cfg.queue, 2)
      flow.link(cfg.queue, 'checkout', 2)
    }
  }

  // True from the crash until the restart has looked for unfinished orders.
  crashed(tick: number) {
    const c = this.cfg.events.crash
    return !!c && tick >= c.at && tick < c.at + c.down
  }

  phaseAt(tick: number) {
    return [...this.cfg.phases].reverse().find((p) => p.from <= tick)
  }

  nextInFront(from: string) {
    const keys = [...this.cfg.front.map((f) => f.key), 'checkout']
    return keys[keys.indexOf(from) + 1]
  }

  // Where a charge goes first, and after each part on the road.
  road() {
    return this.cfg.lane[0]?.key ?? 'provider'
  }
  onward(job: Job, from: string, sim: FlowSim) {
    const lane = this.cfg.lane
    const i = lane.findIndex((l) => l.key === from)
    sim.forward(job, from, lane[i + 1]?.key ?? 'provider')
  }

  // --- Requests coming in -----------------------------------------------------

  newOrder(sim: FlowSim, phase: Phase) {
    const order: Order = { id: this.nextOrder++, at: sim.tick, state: 'open', charges: 0, refunds: 0, chargedAt: 0, live: 0, queued: false, recover: false, intent: false, saving: false, bad: 0 }
    this.orders.set(order.id, order)
    const clicks = phase.clicks !== undefined ? 1 + phase.clicks : sim.rng() < this.cfg.dupes ? 2 : 1
    for (let i = 0; i < clicks; i++) this.clicks.push({ at: sim.tick + (i === 0 ? 0 : 3 * i + Math.floor(sim.rng() * 4)), order, idx: i })
  }

  // Once a tick: clicks that are due, and the day's events.
  tick(sim: FlowSim) {
    const { events, crash } = this.cfg
    const now = this.clicks.filter((c) => c.at <= sim.tick)
    if (now.length) {
      this.clicks = this.clicks.filter((c) => c.at > sim.tick)
      for (const c of now) {
        const job = sim.newJob(1, c.idx, 'click')
        job.msg = c.order.id
        sim.forward(job, 'shoppers', this.cfg.front[0]?.key ?? 'checkout')
      }
    }
    // One checkout machine dies and loses what it held in memory; the others keep taking clicks.
    if (events.crash?.at === sim.tick) for (const job of this.checkout.lose()) sim.drop(job, 'checkout')
    if (events.crash && sim.tick === events.crash.at + events.crash.down) {
      if (crash === 1) for (const o of this.orders.values()) if (o.recover) this.checkout.recovery.push(o)
      if (crash === 2) this.refund()
    }
    if (crash === 2 && sim.tick % SECOND === 0) this.refund()
  }

  // The reconciliation sweep: money taken for an order that never was.
  private refund() {
    for (const o of this.orders.values()) if (o.state === 'failed' && o.live <= 0 && !o.saving && o.charges > o.refunds) o.refunds = o.charges
  }

  // --- Answers --------------------------------------------------------------------

  // The provider made a charge.
  executed(job: Job, sim: FlowSim) {
    const order = this.orders.get(job.msg!)!
    order.charges++
    order.chargedAt = sim.tick
    this.dedupe?.commit(job.key!, sim)
  }

  answer(job: Job, ok: boolean, who: Who, sim: FlowSim) {
    if (who !== 'dedupe') this.dedupe?.resolve(job, ok, sim)
    if (who === 'provider') this.breaker?.record(ok, sim)
    this.checkout.reply(job, ok, who, sim)
  }

  saved(job: Job, sim: FlowSim) {
    const order = this.orders.get(job.msg!)!
    order.saving = false
    order.state = 'saved'
    this.checkout.finished(job, sim)
  }

  // Something was thrown away on its way.
  private onDrop(job: Job) {
    const order = this.orders.get(job.msg!)
    if (!order) return
    if (job.from === 'click') this.settleFail(order)
    else if (job.from === 'order') {
      order.queued = false
      if (this.cfg.crash === 1 && order.intent) order.recover = true
      else this.settleFail(order)
    }
  }

  // An order nobody is working on, nobody holds and no write is on its way to is lost.
  settleFail(order: Order) {
    if (order.state === 'open' && order.live <= 0 && !order.queued && !order.recover && !order.saving) order.state = 'failed'
  }

  // --- What the checks read -----------------------------------------------------

  count(test: (o: Order) => boolean) {
    let n = 0
    for (const o of this.orders.values()) if (test(o)) n++
    return n
  }

  // Customers charged more than once.
  doubles() {
    return this.count((o) => o.charges - o.refunds > 1)
  }

  // Customers charged with no order written down, and nobody working on one.
  orphans() {
    const t = this.flow.tick
    return this.count((o) => o.state !== 'saved' && o.charges - o.refunds > 0 && o.live <= 0 && !o.queued && !o.recover && !o.saving && t - o.chargedAt > STUCK)
  }

  failed() {
    return this.count((o) => o.state === 'failed')
  }

  // What the crash cost: orders in progress when checkout died, how many are lost, and how many of those had been charged.
  crashLoss() {
    let lost = 0
    let charged = 0
    for (const o of this.crashHit) {
      if (o.state === 'saved' || o.state === 'open') continue
      lost++
      if (o.charges > 0) charged++
    }
    return { hit: this.crashHit.size, lost, charged }
  }

  // Orders still not charged after a long time.
  late(after = LATE) {
    const t = this.flow.tick
    return this.count((o) => o.state === 'open' && t - o.at > after)
  }

  // Orders not yet charged and written down, and not given up on.
  waiting() {
    return this.count((o) => o.state === 'open')
  }

  savedCount() {
    return this.count((o) => o.state === 'saved')
  }

  // Seconds an average click took to be answered, over the last few hundred.
  wait() {
    return this.flow.avgLatency() / SECOND
  }
}
