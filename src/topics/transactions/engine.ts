// Distributed transactions, in miniature:
//
//   Orders ──▶ Stock, Payment, Shipping
//
// A customer places an order. Orders must get all three services to do their
// part, or none. How it tries is its `mode`:
//   - naive: ask Stock, then Payment, then Shipping. If one refuses, the ones
//     before it stay done.
//   - 2pc: two-phase commit. Phase 1: ask all three to prepare. Each one locks
//     its part and votes yes, or votes no. Phase 2: if all voted yes, tell
//     everyone to commit, otherwise to abort. A locked service serves nobody
//     else until it hears the verdict.
//   - saga: ask each in turn, and each commits at once. If one refuses, undo
//     the finished ones, last first.
//
// With `crash` on, Orders crashes in the middle of every other order, starting
// with the first: in 2pc after everyone voted yes but before the verdict, in
// the others right after Payment is done. Orders then stays down for a while.
// A saga with `log` remembers where it was and carries on when Orders is back.
// Without it, whatever Orders was doing is forgotten.

import type { Place } from './world'
import { PARTS, TICKS_PER_SECOND } from './world'
import type { TransactionsState } from './types'

export const LATENCY = 24 // ticks for a message to cross between Orders and a service
const DOWN = 120 // ticks a crashed Orders stays down
const FLASH = TICKS_PER_SECOND * 2

// What one service holds for one order.
export type Hold = 'idle' | 'held' | 'done' | 'undone' | 'refused'
export type Outcome = 'running' | 'committed' | 'aborted' | 'broken'

export type Kind = 'do' | 'ok' | 'fail' | 'undo' | 'undone' | 'ask' | 'yes' | 'no' | 'commit' | 'abort' | 'ack'

export interface Msg {
  id: number
  from: Place
  to: Place
  sentAt: number
  arrive: number
  kind: Kind
  order: number
  part: number // index into PARTS
  again?: boolean // sent a second time after Orders came back
}

export interface Order {
  id: number
  holds: Hold[]
  outcome: Outcome
  votes: (boolean | null)[]
  decided: boolean // 2pc: the verdict has gone out
  verdict: 'commit' | 'abort' | null
  acks: number
  undo: number[] // saga: services still to undo, in order
  next: number // saga: the next service to ask
  pending: { kind: 'do' | 'undo'; part: number } | null // saga: asked, no answer yet
  logged: number // saga: how many steps the progress log says were sent
  times: number[] // how often each service did its work for this order
  crashes: boolean
  stuck: boolean // Orders crashed while holding this order's progress
  endedAt: number
}

export interface TransactionsMetrics {
  orders: number
  committed: number // all three did their part
  aborted: number // none of them kept anything
  broken: number // some did and some did not
  running: number
  locked: number // services holding a lock right now
  stalled: number // orders waiting for a lock right now
  stalls: number // orders that ever had to wait for a lock
  undone: number // steps taken back
  doubles: number // steps a service did twice for one order
  crashes: number
}

export class TransactionsSim {
  msgs: Msg[] = []
  tick = 0
  orders = new Map<number, Order>()
  holder: (number | null)[] = [null, null, null] // 2pc: the order holding each service's lock
  queue: number[][] = [[], [], []] // 2pc: orders waiting for each service's lock
  inbox: Msg[] = [] // messages that arrived while Orders was down
  downUntil = 0
  crashes = 0
  stalls = 0
  undone = 0
  brokenAt = -FLASH
  backAt = -FLASH // Orders came back
  repeatAt = -FLASH // a service got a step it had already done
  repeatPart = 0
  repeatIgnored = false

  private st: TransactionsState = { tap: 0, pace: 0, batch: 1, mode: 'naive', fail: 'none', crash: false, log: false, keys: false }
  private cfg: string | null = null
  private tapSeen = 0
  private loopKey = ''
  private taps = 0
  private autoIn = 0
  private msgId = 0
  private orderId = 0

  get down() {
    return this.tick < this.downUntil
  }

  apply(st: TransactionsState) {
    this.st = st
    // Changing how things work starts a fresh shop, so the counts stay readable.
    const cfg = [st.mode, st.fail, st.crash, st.log, st.keys].join('|')
    if (this.cfg !== null && cfg !== this.cfg) this.reset()
    this.cfg = cfg
    if (st.tap !== this.tapSeen) {
      if (st.tap > this.tapSeen) this.taps += st.tap - this.tapSeen
      this.tapSeen = st.tap
    }
    // A new pace or batch size starts the next round soon, so the change shows at once.
    const loopKey = `${st.pace}|${st.batch}`
    if (st.pace > 0 && (this.autoIn <= 0 || loopKey !== this.loopKey)) this.autoIn = Math.round(TICKS_PER_SECOND / 2)
    this.loopKey = loopKey
    if (st.pace <= 0) this.autoIn = 0
  }

  private reset() {
    this.msgs = []
    this.orders.clear()
    this.holder = [null, null, null]
    this.queue = [[], [], []]
    this.inbox = []
    this.downUntil = 0
    this.crashes = 0
    this.stalls = 0
    this.undone = 0
    this.brokenAt = -FLASH
    this.backAt = -FLASH
    this.repeatAt = -FLASH
    this.taps = 0
    this.autoIn = 0
    this.orderId = 0
  }

  private toPart(o: Order, part: number, kind: Kind, again = false) {
    if (kind === 'do' || kind === 'undo') o.pending = { kind, part }
    if (kind === 'do') o.logged = Math.max(o.logged, part + 1)
    this.msgs.push({ id: this.msgId++, from: 'coord', to: PARTS[part], sentAt: this.tick, arrive: this.tick + LATENCY, kind, order: o.id, part, again })
  }

  private toCoord(o: Order, part: number, kind: Kind) {
    this.msgs.push({ id: this.msgId++, from: PARTS[part], to: 'coord', sentAt: this.tick, arrive: this.tick + LATENCY, kind, order: o.id, part })
  }

  private newOrder() {
    const id = ++this.orderId
    const o: Order = {
      id,
      holds: ['idle', 'idle', 'idle'],
      outcome: 'running',
      votes: [null, null, null],
      decided: false,
      verdict: null,
      acks: 0,
      undo: [],
      next: 0,
      pending: null,
      logged: 0,
      times: [0, 0, 0],
      crashes: this.st.crash && id % 2 === 1,
      stuck: false,
      endedAt: 0,
    }
    this.orders.set(id, o)
    if (this.st.mode === '2pc') PARTS.forEach((_, p) => this.toPart(o, p, 'ask'))
    else this.advance(o)
  }

  private finish(o: Order, outcome: Outcome) {
    o.outcome = outcome
    o.endedAt = this.tick
    if (outcome === 'broken') this.brokenAt = this.tick
  }

  // Orders gives up an order that nothing can finish, and looks at what is left.
  private abandon(o: Order) {
    this.msgs = this.msgs.filter((m) => m.order !== o.id)
    this.finish(o, o.holds.some((h) => h === 'done') ? 'broken' : 'aborted')
  }

  private crash(o: Order) {
    this.downUntil = this.tick + DOWN
    this.crashes++
    const running = [...this.orders.values()].filter((x) => x.outcome === 'running')
    if (this.st.mode === '2pc') o.stuck = true
    // Whatever the log says was sent, every unfinished order picks up from there.
    else if (this.st.mode === 'saga' && this.st.log) for (const x of running) x.stuck = true
    else for (const x of running) this.abandon(x)
  }

  // Saga and naive: ask the next service, or finish.
  private advance(o: Order) {
    if (o.next >= PARTS.length) return this.finish(o, 'committed')
    this.toPart(o, o.next, 'do')
  }

  // Saga: take back the next finished step, or finish.
  private rollBack(o: Order) {
    const p = o.undo.shift()
    if (p === undefined) return this.finish(o, 'aborted')
    this.undone++
    this.toPart(o, p, 'undo')
  }

  private decide(o: Order, verdict: 'commit' | 'abort') {
    o.decided = true
    o.verdict = verdict
    PARTS.forEach((_, p) => this.toPart(o, p, verdict))
  }

  private onCoord(m: Msg) {
    const o = this.orders.get(m.order)
    if (!o || o.outcome !== 'running') return
    const p = m.part
    switch (m.kind) {
      case 'ok':
        o.pending = null
        o.next = p + 1
        this.advance(o)
        // Orders crashes just after asking Shipping, before the answer is back.
        if (p === 1 && o.crashes && o.outcome === 'running') {
          o.crashes = false
          this.crash(o)
        }
        return
      case 'fail':
        o.pending = null
        if (this.st.mode === 'saga') {
          o.undo = o.holds.flatMap((h, i) => (h === 'done' ? [i] : [])).reverse()
          return this.rollBack(o)
        }
        return this.finish(o, o.holds.some((h) => h === 'done') ? 'broken' : 'aborted')
      case 'undone':
        o.pending = null
        return this.rollBack(o)
      case 'yes':
      case 'no': {
        o.votes[p] = m.kind === 'yes'
        if (o.decided) return
        if (o.votes.some((v) => v === false)) return this.decide(o, 'abort')
        if (o.votes.every((v) => v === true)) {
          if (o.crashes) {
            o.crashes = false
            return this.crash(o)
          }
          this.decide(o, 'commit')
        }
        return
      }
      case 'ack':
        if (++o.acks === PARTS.length) this.finish(o, o.verdict === 'commit' ? 'committed' : 'aborted')
    }
  }

  // 2pc: a service gets asked to prepare, if it is free.
  private ask(o: Order, p: number) {
    if (this.holder[p] !== null) {
      this.queue[p].push(o.id)
      this.stalls++
      return
    }
    if (this.st.fail === PARTS[p]) {
      o.holds[p] = 'refused'
      return this.toCoord(o, p, 'no')
    }
    this.holder[p] = o.id
    o.holds[p] = 'held'
    this.toCoord(o, p, 'yes')
  }

  private release(o: Order, p: number, verdict: 'commit' | 'abort') {
    this.queue[p] = this.queue[p].filter((id) => id !== o.id)
    if (this.holder[p] === o.id) this.holder[p] = null
    if (o.holds[p] === 'held') o.holds[p] = verdict === 'commit' ? 'done' : 'idle'
    this.toCoord(o, p, 'ack')
    while (this.holder[p] === null && this.queue[p].length) {
      const next = this.orders.get(this.queue[p].shift()!)
      if (next && next.outcome === 'running') this.ask(next, p)
    }
  }

  private onPart(m: Msg) {
    const o = this.orders.get(m.order)
    if (!o) return
    const p = m.part
    switch (m.kind) {
      case 'do':
        if (o.holds[p] === 'done') {
          // A repeat of a step this service already did.
          this.repeatAt = this.tick
          this.repeatPart = p
          this.repeatIgnored = this.st.keys
          if (!this.st.keys) o.times[p]++
          return this.toCoord(o, p, 'ok')
        }
        if (this.st.fail === PARTS[p]) {
          o.holds[p] = 'refused'
          return this.toCoord(o, p, 'fail')
        }
        o.holds[p] = 'done'
        o.times[p] = 1
        return this.toCoord(o, p, 'ok')
      case 'undo':
        o.holds[p] = 'undone'
        return this.toCoord(o, p, 'undone')
      case 'ask':
        return this.ask(o, p)
      case 'commit':
      case 'abort':
        return this.release(o, p, m.kind)
    }
  }

  // Orders is back: carry on with what it kept.
  private recover() {
    this.backAt = this.tick
    const back = this.inbox
    this.inbox = []
    for (const o of this.orders.values()) {
      if (!o.stuck || o.outcome !== 'running') continue
      o.stuck = false
      // Nothing was announced yet, so the safe verdict is to abort.
      if (this.st.mode === '2pc') this.decide(o, 'abort')
      // The log says what was sent, not whether it finished, so ask again.
      else if (o.pending) this.toPart(o, o.pending.part, o.pending.kind, true)
      else this.advance(o)
    }
    for (const m of back) this.onCoord(m)
  }

  step() {
    this.tick++
    const t = this.tick
    const wasDown = this.downUntil > 0 && t === this.downUntil
    if (wasDown) this.recover()

    const due = this.msgs.filter((m) => m.arrive <= t)
    this.msgs = this.msgs.filter((m) => m.arrive > t)
    for (const m of due) {
      if (m.to !== 'coord') this.onPart(m)
      // Two-phase commit's answers wait in a durable queue. Elsewhere they are lost.
      else if (this.down) {
        if (this.st.mode === '2pc') this.inbox.push(m)
      }
      else this.onCoord(m)
    }

    // Customers keep ordering while a two-phase commit coordinator is down:
    // another copy of Orders takes the order. Otherwise orders wait for it.
    const open = !this.down || this.st.mode === '2pc'
    for (; open && this.taps > 0; this.taps--) this.newOrder()
    if (this.st.pace > 0 && open && --this.autoIn <= 0) {
      this.autoIn = Math.round(TICKS_PER_SECOND / this.st.pace)
      for (let i = 0; i < this.st.batch; i++) this.newOrder()
    }
  }

  get metrics(): TransactionsMetrics {
    const all = [...this.orders.values()]
    const count = (o: Outcome) => all.filter((x) => x.outcome === o).length
    return {
      orders: all.length,
      committed: count('committed'),
      aborted: count('aborted'),
      broken: count('broken'),
      running: count('running'),
      locked: this.holder.filter((h) => h !== null).length,
      stalled: this.queue.reduce((n, q) => n + q.length, 0),
      stalls: this.stalls,
      undone: this.undone,
      doubles: all.reduce((n, o) => n + o.times.filter((t) => t > 1).length, 0),
      crashes: this.crashes,
    }
  }

  // The newest order, which the labels describe.
  get latest(): Order | null {
    let top: Order | null = null
    for (const o of this.orders.values()) if (!top || o.id > top.id) top = o
    return top
  }
}
