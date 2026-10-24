// Idempotency, in miniature:
//
//   Phone ──▶ Payments ──▶ Ledger
//
// A customer taps Pay. The phone asks Payments to charge 50, and Payments
// writes the charge in the ledger and sends an answer back. The network can
// lose the request or the answer, so the phone tries again after a wait.
//
// What Payments does about a repeat is its `keys` setting:
//   - none: every request is a new payment.
//   - check: look the key up before charging, and save it once the work is done.
//   - atomic: claim the key in one step before doing anything. A second request
//     with the same key is ignored while the first is still in progress.
//
// The phone and the ledger are always reachable. Only the two messages the
// scene asks to lose are lost, and only on the first try of a payment.

import type { Place } from './world'
import { TICKS_PER_SECOND } from './world'
import type { IdempotencyState } from './types'

export const LATENCY = 18 // ticks for a message to cross between the phone and Payments
const HOP = 8 // ticks from Payments to the ledger
const WORK = 12 // ticks Payments needs for one payment: the charge is written halfway
const RETRY = 66 // the phone asks again when no answer has come after this long
const DOWN = 50 // ticks a crashed Payments stays down
const MAX_TRIES = 6
const FLASH = TICKS_PER_SECOND * 2

interface Wire {
  id: number
  from: Place
  to: Place
  sentAt: number
  arrive: number
  doomed?: boolean // lost on the way: it never arrives
}

export type Body =
  | { kind: 'pay'; order: number; attempt: number; copy: boolean; key: number | null }
  | { kind: 'reply'; order: number; replay: boolean }
  | { kind: 'charge'; order: number }

export type Msg = Wire & Body

export interface Entry {
  order: number
  dup: boolean // this order was already in the ledger
}

interface Payment {
  order: number
  tries: number
  lastSend: number
  state: 'waiting' | 'paid' | 'unknown'
}

interface Job {
  order: number
  attempt: number
  copy: boolean
  key: number | null
  start: number
  charged: boolean
  crashes: boolean
}

export interface IdempotencyMetrics {
  orders: number // payments started
  paid: number // payments the phone was told went through
  unknown: number // payments the phone gave up on
  waiting: number
  charges: number // entries in the ledger
  dupes: number // entries for an order that was already there
  retries: number
  crashes: number
  replays: number // saved answers sent instead of charging again
}

export class IdempotencySim {
  msgs: Msg[] = []
  tick = 0
  ledger: Entry[] = []
  records = new Map<number, boolean>() // key -> done? (false = claimed, still in progress)
  payments = new Map<number, Payment>()
  jobs: Job[] = []
  downUntil = 0
  crashes = 0
  retries = 0
  replays = 0
  dupeAt = -FLASH

  private st: IdempotencyState = { tap: 0, pace: 0, lose: 'none', retry: true, op: 'add', keys: 'none', double: false, crash: false, together: false, sender: 'phone' }
  private cfg: string | null = null
  private tapSeen = 0
  private tapDue = false
  private autoIn = 0
  private msgId = 0
  private orderId = 0

  get down() {
    return this.tick < this.downUntil
  }

  apply(st: IdempotencyState) {
    this.st = st
    // Changing how things work starts a fresh ledger, so the counts stay readable.
    const cfg = [st.op, st.keys, st.together, st.sender, st.retry, st.crash, st.double, st.lose].join('|')
    if (this.cfg !== null && cfg !== this.cfg) this.reset()
    this.cfg = cfg
    if (st.tap !== this.tapSeen) {
      this.tapDue = st.tap > this.tapSeen
      this.tapSeen = st.tap
    }
    if (st.pace > 0 && this.autoIn <= 0) this.autoIn = Math.round(TICKS_PER_SECOND / 2)
    if (st.pace <= 0) this.autoIn = 0
  }

  private reset() {
    this.msgs = []
    this.ledger = []
    this.records.clear()
    this.payments.clear()
    this.jobs = []
    this.downUntil = 0
    this.crashes = 0
    this.retries = 0
    this.replays = 0
    this.dupeAt = -FLASH
    this.tapDue = false
    this.autoIn = 0
  }

  private send(from: Place, to: Place, body: Body, doomed = false, ticks = LATENCY) {
    this.msgs.push({ id: this.msgId++, from, to, sentAt: this.tick, arrive: this.tick + ticks, doomed, ...body })
  }

  private ask(p: Payment, copy = false) {
    const attempt = p.tries
    const first = attempt === 0 && !copy
    if (!copy) p.tries++
    p.lastSend = this.tick
    const key = this.st.keys === 'none' ? null : p.order
    this.send('phone', 'server', { kind: 'pay', order: p.order, attempt, copy, key }, first && this.st.lose === 'request')
  }

  private newPayment() {
    const p: Payment = { order: ++this.orderId, tries: 0, lastSend: this.tick, state: 'waiting' }
    this.payments.set(p.order, p)
    this.ask(p)
    if (this.st.double) this.ask(p, true)
  }

  private reply(order: number, replay: boolean, doomed = false) {
    this.send('server', 'phone', { kind: 'reply', order, replay }, doomed)
  }

  private onPay(m: Msg & { kind: 'pay' }) {
    if (this.down) return
    if (m.key !== null) {
      const done = this.records.get(m.key)
      if (done) {
        this.replays++
        return this.reply(m.order, true)
      }
      if (done === false && this.st.keys === 'atomic') return // the first request is still being handled
      if (this.st.keys === 'atomic') this.records.set(m.key, false)
    }
    const first = m.attempt === 0 && !m.copy
    this.jobs.push({ order: m.order, attempt: m.attempt, copy: m.copy, key: m.key, start: this.tick, charged: false, crashes: first && this.st.crash })
  }

  private onCharge(m: Msg & { kind: 'charge' }) {
    const dup = this.ledger.some((e) => e.order === m.order)
    if (dup && this.st.op === 'set') return // setting "paid" again changes nothing
    this.ledger.push({ order: m.order, dup })
    if (dup) this.dupeAt = this.tick
  }

  private onReply(m: Msg & { kind: 'reply' }) {
    const p = this.payments.get(m.order)
    if (p && p.state === 'waiting') p.state = 'paid'
  }

  private crash() {
    this.downUntil = this.tick + DOWN
    this.crashes++
    this.jobs = []
    // A claim that was never finished is lost with the server's memory.
    for (const [key, done] of this.records) if (!done) this.records.delete(key)
  }

  private work() {
    for (const j of [...this.jobs]) {
      const age = this.tick - j.start
      if (!j.charged && age >= WORK / 2) {
        j.charged = true
        this.send('server', 'ledger', { kind: 'charge', order: j.order }, false, HOP)
        if (j.key !== null && this.st.together) this.records.set(j.key, true)
      }
      if (j.charged && j.crashes && age >= WORK / 2 + 1) return this.crash()
      if (age >= WORK) {
        if (j.key !== null) this.records.set(j.key, true)
        this.reply(j.order, false, this.st.lose === 'reply' && j.attempt === 0 && !j.copy)
        this.jobs = this.jobs.filter((x) => x !== j)
      }
    }
  }

  private phone() {
    for (const p of this.payments.values()) {
      if (p.state !== 'waiting' || this.tick - p.lastSend < RETRY) continue
      if (this.st.retry && p.tries < MAX_TRIES) {
        this.retries++
        this.ask(p)
      } else p.state = 'unknown'
    }
  }

  step() {
    this.tick++
    const t = this.tick
    const due = this.msgs.filter((m) => m.arrive <= t)
    this.msgs = this.msgs.filter((m) => m.arrive > t)
    for (const m of due) {
      if (m.doomed) continue
      if (m.kind === 'pay') this.onPay(m)
      else if (m.kind === 'charge') this.onCharge(m)
      else this.onReply(m)
    }

    if (this.tapDue) {
      this.tapDue = false
      this.newPayment()
    }
    if (this.st.pace > 0 && --this.autoIn <= 0) {
      this.autoIn = Math.round(TICKS_PER_SECOND / this.st.pace)
      this.newPayment()
    }

    if (!this.down) this.work()
    this.phone()
  }

  get metrics(): IdempotencyMetrics {
    const states = [...this.payments.values()]
    return {
      orders: states.length,
      paid: states.filter((p) => p.state === 'paid').length,
      unknown: states.filter((p) => p.state === 'unknown').length,
      waiting: states.filter((p) => p.state === 'waiting').length,
      charges: this.ledger.length,
      dupes: this.ledger.filter((e) => e.dup).length,
      retries: this.retries,
      crashes: this.crashes,
      replays: this.replays,
    }
  }

  // The newest payment, which the phone shows.
  get latest(): Payment | null {
    let top: Payment | null = null
    for (const p of this.payments.values()) if (!top || p.order > top.order) top = p
    return top
  }
}
