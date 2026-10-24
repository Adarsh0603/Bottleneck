// A Bloom filter, in miniature:
//
//   Sign-up form ──▶ Filter ──▶ Database
//
// A user types a username and the form asks whether it is taken. The database
// knows for sure but answers slowly, one lookup at a time. The filter sits in
// front of it: a strip of switches, all off at the start.
//
//   - Saving a name hashes it to `hashes` positions and turns those switches on.
//   - Checking a name hashes it the same way. If any of its switches is off, no
//     saved name can be there, so the answer is "definitely free" and the
//     database is skipped. If all are on, the answer is "maybe", so the database
//     is asked. A "maybe" for a free name is a false positive: a wasted trip.
//
// Deleting a name is the hard part. With plain switches, clearing a name's
// switches also clears switches that other names share, so those names are then
// wrongly called free. With `counting`, each position counts the names using it
// and is only off at zero.

import type { Place } from './world'
import { TICKS_PER_SECOND } from './world'
import type { BloomState, Kind } from './types'

const LATENCY = 14 // ticks for a message to cross from the form to the filter, or the filter to the database
const CHECK = 8 // ticks the filter takes to look at the switches
const LOOKUP = 24 // ticks the database needs for one lookup
const BACK = 26 // ticks for the database's answer to reach the form
const LIT = 44 // ticks a checked name's switches stay marked
const FRESH = 1000 // new names are numbered from here, saved ones below
const SEARCH = 4000

function mix(n: number, seed: number) {
  let h = Math.imul(n + 1, 0x9e3779b1) ^ Math.imul(seed, 0x85ebca6b)
  h ^= h >>> 15
  h = Math.imul(h, 0x2c1b3c6d)
  h ^= h >>> 12
  h = Math.imul(h, 0x297a2d39)
  h ^= h >>> 15
  return h >>> 0
}

// The switches a name turns on: `hashes` different positions out of `bits`.
export function cellsFor(id: number, hashes: number, bits: number): number[] {
  const out: number[] = []
  const step = mix(id, 2) | 1
  let x = mix(id, 1)
  for (let tries = 0; out.length < hashes && tries < bits * 4; tries++) {
    const c = x % bits
    if (!out.includes(c)) out.push(c)
    x = (x + step) >>> 0
  }
  return out
}

interface Wire {
  id: number
  from: Place
  to: Place
  sentAt: number
  arrive: number
}

export type Body = { kind: 'ask'; n: number } | { kind: 'lookup'; n: number } | { kind: 'answer'; n: number; free: boolean }

export type Msg = Wire & Body

export interface Query {
  n: number
  id: number // which name
  cells: number[]
}

// The switches a check looked at, kept for a moment so the scene can mark them.
export interface Probe {
  n: number
  id: number
  cells: number[]
  at: number
  maybe: boolean // every switch was on
  wrong: boolean // the name is saved but a switch was off
}

export interface BloomMetrics {
  asked: number
  answered: number
  waiting: number // asked, not yet answered
  trips: number // lookups that reached the database
  skipped: number // answered by the filter alone
  wasted: number // lookups for a name that turned out free
  wrong: number // told "free" for a saved name
  deleted: number
  queue: number // lookups waiting at the database
  fillPct: number // switches that are on
  fpPct: number // chance a new name gets a "maybe"
}

export class BloomSim {
  msgs: Msg[] = []
  tick = 0
  counts: number[] = []
  litAt: number[] = [] // tick each switch last changed
  names = new Set<number>()
  queries = new Map<number, Query>()
  probes: Probe[] = []
  checking: { n: number; readyAt: number }[] = []
  dbQueue: number[] = []
  busy: { n: number; doneAt: number } | null = null
  lastAnswer: { n: number; id: number; free: boolean; wrong: boolean; at: number } | null = null
  lastDrop: { id: number; cells: number[]; at: number } | null = null

  private asked = 0
  private answered = 0
  private trips = 0
  private skipped = 0
  private wasted = 0
  private wrong = 0
  private deleted = 0

  private st: BloomState = { ask: 0, kind: 'new', pace: 0, taken: 20, filter: true, bits: 32, hashes: 1, names: 0, counting: false, drop: 0, round: 0 }
  private cfg: string | null = null
  private built = 0
  private askSeen = 0
  private askDue: Kind | null = null
  private dropSeen = 0
  private dropDue = false
  private autoIn = 0
  private msgId = 0
  private queryId = 0
  private fresh = FRESH
  private takenAt = 0
  private friendAt = 0
  private acc = 0

  apply(st: BloomState) {
    this.st = st
    // Changing how the filter is built starts it again, so the counts stay readable.
    const cfg = [st.filter, st.bits, st.hashes, st.counting, st.taken, st.round].join('|')
    const first = this.cfg === null
    const changed = !first && cfg !== this.cfg
    this.cfg = cfg
    // A sim created partway through a chapter does not replay earlier checks.
    if (first) {
      this.askSeen = st.ask
      this.dropSeen = st.drop
    }
    if (changed) this.reset()
    if (first || changed || st.names < this.built) this.rebuild(st.names)
    else if (st.names > this.built) this.grow(st.names)

    if (st.ask !== this.askSeen) {
      this.askDue = st.ask > this.askSeen ? st.kind : null
      this.askSeen = st.ask
    }
    if (st.drop !== this.dropSeen) {
      this.dropDue = st.drop > this.dropSeen
      this.dropSeen = st.drop
    }
    if (st.pace > 0 && this.autoIn <= 0) this.autoIn = Math.round(TICKS_PER_SECOND / 2)
    if (st.pace <= 0) this.autoIn = 0
  }

  private reset() {
    this.msgs = []
    this.queries.clear()
    this.probes = []
    this.checking = []
    this.dbQueue = []
    this.busy = null
    this.lastAnswer = null
    this.lastDrop = null
    this.asked = this.answered = this.trips = this.skipped = this.wasted = this.wrong = this.deleted = 0
    this.askDue = null
    this.dropDue = false
    this.autoIn = 0
    this.acc = 0
    this.takenAt = 0
    this.friendAt = 0
  }

  private rebuild(n: number) {
    this.counts = new Array<number>(this.st.bits).fill(0)
    this.litAt = new Array<number>(this.st.bits).fill(-LIT)
    this.names.clear()
    this.built = 0
    this.grow(n)
  }

  // Saves names built..n-1, one after another.
  private grow(n: number) {
    for (let id = this.built; id < n; id++) this.save(id)
    this.built = n
  }

  private save(id: number) {
    for (const c of cellsFor(id, this.st.hashes, this.st.bits)) {
      this.counts[c] = this.st.counting ? this.counts[c] + 1 : 1
      this.litAt[c] = this.tick
    }
    this.names.add(id)
  }

  private forget(id: number) {
    for (const c of cellsFor(id, this.st.hashes, this.st.bits)) {
      this.counts[c] = this.st.counting ? Math.max(0, this.counts[c] - 1) : 0
      this.litAt[c] = this.tick
    }
    this.names.delete(id)
  }

  isOn(c: number) {
    return this.counts[c] > 0
  }

  private maybe(cells: number[]) {
    return cells.every((c) => this.isOn(c))
  }

  // The saved name that shares switches with the most other saved names.
  private mostShared(): number {
    let best = -1
    let top = -1
    for (const id of this.names) {
      const mine = new Set(cellsFor(id, this.st.hashes, this.st.bits))
      let shared = 0
      for (const other of this.names) {
        if (other !== id && cellsFor(other, this.st.hashes, this.st.bits).some((c) => mine.has(c))) shared++
      }
      if (shared > top) {
        top = shared
        best = id
      }
    }
    return best
  }

  private friends(): number[] {
    if (!this.lastDrop) return []
    const gone = new Set(this.lastDrop.cells)
    return [...this.names].filter((id) => cellsFor(id, this.st.hashes, this.st.bits).some((c) => gone.has(c)))
  }

  private newName(want: 'clear' | 'on' | 'any'): number {
    const { hashes, bits } = this.st
    for (let id = this.fresh; id < this.fresh + SEARCH; id++) {
      const lit = this.maybe(cellsFor(id, hashes, bits))
      if (want === 'any' || (want === 'on') === lit) {
        this.fresh = id + 1
        return id
      }
    }
    return this.fresh++
  }

  private savedName(pool: number[]): number | null {
    if (!pool.length) return null
    return pool[this.takenAt++ % pool.length]
  }

  private pick(kind: Kind): number {
    if (kind === 'friend') {
      const pool = this.friends()
      if (pool.length) return pool[this.friendAt++ % pool.length]
      kind = 'taken'
    }
    if (kind === 'taken') return this.savedName([...this.names]) ?? this.newName('any')
    if (kind === 'mix') {
      this.acc += this.st.taken
      if (this.acc >= 100) {
        this.acc -= 100
        return this.savedName([...this.names]) ?? this.newName('any')
      }
      return this.newName('any')
    }
    return this.newName(kind === 'new' ? 'clear' : 'on')
  }

  private send(from: Place, to: Place, body: Body, ticks: number) {
    this.msgs.push({ id: this.msgId++, from, to, sentAt: this.tick, arrive: this.tick + ticks, ...body })
  }

  private start(kind: Kind) {
    const id = this.pick(kind)
    const n = ++this.queryId
    this.queries.set(n, { n, id, cells: cellsFor(id, this.st.hashes, this.st.bits) })
    this.asked++
    // Without a filter the name goes straight to the database.
    if (this.st.filter) this.send('form', 'filter', { kind: 'ask', n }, LATENCY)
    else this.send('form', 'db', { kind: 'lookup', n }, LATENCY * 2)
  }

  private onAsk(n: number) {
    const q = this.queries.get(n)
    if (!q) return
    this.probes.push({ n, id: q.id, cells: q.cells, at: this.tick, maybe: this.maybe(q.cells), wrong: !this.maybe(q.cells) && this.names.has(q.id) })
    this.checking.push({ n, readyAt: this.tick + CHECK })
  }

  private decide() {
    for (const c of this.checking.filter((x) => x.readyAt <= this.tick)) {
      const p = this.probes.find((x) => x.n === c.n)
      if (!p) continue
      if (p.maybe) this.send('filter', 'db', { kind: 'lookup', n: c.n }, LATENCY)
      else {
        this.skipped++
        this.send('filter', 'form', { kind: 'answer', n: c.n, free: true }, LATENCY)
      }
    }
    this.checking = this.checking.filter((x) => x.readyAt > this.tick)
  }

  private database() {
    if (this.busy && this.busy.doneAt <= this.tick) {
      const q = this.queries.get(this.busy.n)
      if (q) {
        const free = !this.names.has(q.id)
        if (free) this.wasted++
        this.send('db', 'form', { kind: 'answer', n: q.n, free }, BACK)
      }
      this.busy = null
    }
    if (!this.busy && this.dbQueue.length) this.busy = { n: this.dbQueue.shift()!, doneAt: this.tick + LOOKUP }
  }

  private onAnswer(m: Msg & { kind: 'answer' }) {
    const q = this.queries.get(m.n)
    if (!q) return
    this.answered++
    const wrong = m.free && this.names.has(q.id)
    if (wrong) this.wrong++
    this.lastAnswer = { n: m.n, id: q.id, free: m.free, wrong, at: this.tick }
    this.queries.delete(m.n)
  }

  private drop() {
    const id = this.mostShared()
    if (id < 0) return
    this.lastDrop = { id, cells: cellsFor(id, this.st.hashes, this.st.bits), at: this.tick }
    this.forget(id)
    this.deleted++
    this.friendAt = 0
  }

  step() {
    this.tick++
    const t = this.tick
    const due = this.msgs.filter((m) => m.arrive <= t)
    this.msgs = this.msgs.filter((m) => m.arrive > t)
    for (const m of due) {
      if (m.kind === 'ask') this.onAsk(m.n)
      else if (m.kind === 'lookup') {
        this.trips++
        this.dbQueue.push(m.n)
      } else this.onAnswer(m)
    }

    if (this.dropDue) {
      this.dropDue = false
      this.drop()
    }
    if (this.askDue) {
      const kind = this.askDue
      this.askDue = null
      this.start(kind)
    }
    if (this.st.pace > 0 && --this.autoIn <= 0) {
      this.autoIn = Math.round(TICKS_PER_SECOND / this.st.pace)
      this.start('mix')
    }

    this.decide()
    this.database()
    this.probes = this.probes.filter((p) => t - p.at < LIT + CHECK)
  }

  get metrics(): BloomMetrics {
    const on = this.counts.filter((c) => c > 0).length
    const fill = this.counts.length ? on / this.counts.length : 0
    return {
      asked: this.asked,
      answered: this.answered,
      waiting: this.asked - this.answered,
      trips: this.trips,
      skipped: this.skipped,
      wasted: this.wasted,
      wrong: this.wrong,
      deleted: this.deleted,
      queue: this.dbQueue.length + (this.busy ? 1 : 0),
      fillPct: Math.round(fill * 100),
      fpPct: Math.round(fill ** this.st.hashes * 1000) / 10,
    }
  }
}
