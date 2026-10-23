// Database replication, on the shared flow engine:
//
//                              ┌──▶ replica ┐
//   users ──▶ app servers ─────┼──▶ primary ┼─ ships every change ─▶ replicas
//                              └──▶ replica ┘
//
// Every write goes to the primary. Reads go to the replicas when there are
// any, else to the primary too. The primary ships each change to the
// replicas, which apply it `lag` seconds later; a read that reaches a
// replica before the change does gets old data (a stale read).
//
// Some users read back what they just wrote (a refresh after posting). With
// read-your-own-writes, those reads go to the primary instead.

import { FlowSim, type FlowNode, type Job } from '../../core/flow/engine'
import { Worker } from '../../core/flow/nodes'
import type { ReadFrom, ReplicationState } from './types'
import { MAX_REPLICAS, PRIMARY_KEY, replicaKey, TICKS_PER_SECOND } from './world'

export type Kind = 'read' | 'write' | 'own' // own: reading back your own write

const ITEMS = 60
const WRITE_SHARE = 0.1
const OWN_SHARE = 0.6 // writes followed by the writer reading it back
const FOLLOW_TICKS = [16, 32] // how soon they read it back
const READ_WORK = 12
const WRITE_WORK = 14
export const LINK_TICKS = { usersApp: 8, appDb: 6 }
const WINDOW = TICKS_PER_SECOND * 3
const EVENT_MEMORY = TICKS_PER_SECOND * 2

// Users send reads and writes, and read back some of what they wrote.
class Users implements FlowNode {
  alive = true
  rate = 0 // requests per tick
  readonly key = 'users'
  private carry = 0
  private followUps: { item: number; at: number }[] = []
  private db: ReplicationSim

  constructor(db: ReplicationSim) {
    this.db = db
  }

  receive(job: Job, sim: FlowSim) {
    sim.complete(job)
  }

  readBack(item: number, sim: FlowSim) {
    const [lo, hi] = FOLLOW_TICKS
    this.followUps.push({ item, at: sim.tick + lo + Math.floor(sim.rng() * (hi - lo + 1)) })
  }

  emit(sim: FlowSim) {
    const send = (kind: Kind, item: number) => {
      const job = sim.newJob(1, item, this.key)
      this.db.kindOf.set(job, kind)
      this.db.sent[kind === 'write' ? 'writes' : 'reads']++
      sim.forward(job, this.key, 'app')
    }
    this.carry += this.rate
    while (this.carry >= 1) {
      this.carry -= 1
      send(sim.rng() < WRITE_SHARE ? 'write' : 'read', Math.floor(sim.rng() * ITEMS))
    }
    const due = this.followUps.filter((f) => f.at <= sim.tick)
    this.followUps = this.followUps.filter((f) => f.at > sim.tick)
    for (const f of due) send('own', f.item)
  }
}

// The app servers: decide where each request goes, instantly.
class App implements FlowNode {
  alive = true
  readonly key = 'app'
  private db: ReplicationSim

  constructor(db: ReplicationSim) {
    this.db = db
  }

  receive(job: Job, sim: FlowSim) {
    const to = this.db.route(job)
    if (to) sim.forward(job, this.key, to)
    else sim.drop(job, this.db.leaderKey)
  }
}

// A change on its way from the leader to a replica.
export interface Shipment {
  to: string
  item: number
  version: number
  sentAt: number
  arrive: number
}

export interface ReplicationMetrics {
  readsPerSec: number
  writesPerSec: number
  load: Record<string, number> // how busy each database's slots were, 0–1
  errorRate: number // percent of requests turned away
  staleRate: number // percent of reads answered with old data; NaN with no reads
  ownStaleRate: number // the same, for people reading back their own write
  lostWrites: number // writes the old primary had that never reached the new one
}

interface Sample {
  completed: number
  dropped: number
  reads: number
  writes: number
  served: number
  stale: number
  ownServed: number
  ownStale: number
  busy: Record<string, number>
}

export class ReplicationSim {
  readonly flow: FlowSim
  readonly primary: Worker
  readonly replicas: Worker[] = []
  readonly kindOf = new WeakMap<Job, Kind>()
  readonly sent = { reads: 0, writes: 0 }
  shipping: Shipment[] = []
  staleEvents: { node: string; tick: number }[] = []
  lostWrites = 0

  private users: Users
  private count = 0
  private lagTicks = 8
  private readFrom: ReadFrom = 'replicas'
  private failed = false
  private promoted = false
  private rr = 0
  private versions = new Map<string, Int32Array>()
  private served = 0
  private stale = 0
  private ownServed = 0
  private ownStale = 0
  private busy: Record<string, number> = {}
  private history: Sample[] = []

  constructor(rng: () => number = Math.random) {
    this.flow = new FlowSim(rng)
    this.users = this.flow.add(new Users(this))
    this.flow.add(new App(this))
    this.flow.link('users', 'app', LINK_TICKS.usersApp)

    const db = (key: string) => {
      const w = this.flow.add(new Worker(key, { slots: 4, queueLimit: 8 }))
      w.workOf = (job) => (this.kindOf.get(job) === 'write' ? WRITE_WORK : READ_WORK)
      w.onFinish = (job, sim) => this.finished(key, job, sim)
      this.flow.link('app', key, LINK_TICKS.appDb)
      this.versions.set(key, new Int32Array(ITEMS))
      this.busy[key] = 0
      return w
    }
    this.primary = db(PRIMARY_KEY)
    for (let i = 0; i < MAX_REPLICAS; i++) this.replicas.push(db(replicaKey(i)))
  }

  get tick() {
    return this.flow.tick
  }

  // The database taking writes: the primary, or the replica promoted after it died.
  get leaderKey() {
    return this.promoted ? replicaKey(0) : PRIMARY_KEY
  }

  get leaderUp() {
    return this.promoted || !this.failed
  }

  // Replicas in use, the leader excluded.
  get followers(): string[] {
    return Array.from({ length: this.count }, (_, i) => replicaKey(i)).filter((k) => k !== this.leaderKey)
  }

  apply(st: ReplicationState) {
    this.users.rate = st.rps / TICKS_PER_SECOND
    this.lagTicks = Math.max(1, Math.round(st.lag * TICKS_PER_SECOND))
    this.readFrom = st.readFrom

    // A new replica starts from a copy of the leader's data.
    for (let i = this.count; i < st.replicas; i++) this.versions.get(replicaKey(i))!.set(this.versions.get(this.leaderKey)!)
    this.count = st.replicas

    if (st.failed !== this.failed) {
      this.failed = st.failed
      this.primary.alive = !st.failed
      if (st.failed) {
        // Changes the primary hadn't shipped yet die with it.
        this.flow.fail(PRIMARY_KEY)
        this.shipping = []
      }
    }

    const promoted = st.failed && st.promoted && this.count > 0
    if (promoted !== this.promoted) {
      const before = this.versions.get(this.leaderKey)!
      this.promoted = promoted
      const leader = this.versions.get(this.leaderKey)!
      this.lostWrites = promoted ? before.reduce((sum, v, i) => sum + Math.max(0, v - leader[i]), 0) : 0
      // Everyone now copies from the new leader.
      for (const [key, v] of this.versions) if (key !== this.leaderKey) v.set(leader)
      this.shipping = []
    }
  }

  route(job: Job): string | undefined {
    const kind = this.kindOf.get(job)
    const leader = this.leaderUp ? this.leaderKey : undefined
    if (kind === 'write') return leader
    const followers = this.followers
    if (followers.length === 0 || this.readFrom === 'primary' || (kind === 'own' && this.readFrom === 'own')) return leader ?? followers[0]
    return followers[this.rr++ % followers.length]
  }

  private finished(key: string, job: Job, sim: FlowSim) {
    const item = job.key ?? 0
    if (this.kindOf.get(job) === 'write') {
      const version = ++this.versions.get(key)![item]
      for (const to of this.followers) this.shipping.push({ to, item, version, sentAt: sim.tick, arrive: sim.tick + this.lagTicks })
      if (sim.rng() < OWN_SHARE) this.users.readBack(item, sim)
      return
    }
    const own = this.kindOf.get(job) === 'own'
    const stale = this.versions.get(key)![item] < this.versions.get(this.leaderKey)![item]
    this.served++
    if (own) this.ownServed++
    if (!stale) return
    this.stale++
    if (own) this.ownStale++
    this.staleEvents.push({ node: key, tick: sim.tick })
  }

  step() {
    this.flow.step()
    const t = this.flow.tick
    for (const s of this.shipping) {
      if (s.arrive > t) continue
      const v = this.versions.get(s.to)!
      v[s.item] = Math.max(v[s.item], s.version)
    }
    this.shipping = this.shipping.filter((s) => s.arrive > t)
    this.staleEvents = this.staleEvents.filter((e) => t - e.tick <= EVENT_MEMORY)

    for (const w of [this.primary, ...this.replicas]) this.busy[w.key] += w.active.length / w.slots
    this.history.push({
      completed: this.flow.stats.completed,
      dropped: this.flow.stats.dropped,
      reads: this.sent.reads,
      writes: this.sent.writes,
      served: this.served,
      stale: this.stale,
      ownServed: this.ownServed,
      ownStale: this.ownStale,
      busy: { ...this.busy },
    })
    if (this.history.length > WINDOW + 1) this.history.shift()
  }

  // Replicas beyond the current count aren't drawn or used.
  inUse(key: string) {
    return key === PRIMARY_KEY || this.replicas.findIndex((r) => r.key === key) < this.count
  }

  isDown(key: string) {
    return key === PRIMARY_KEY && this.failed
  }

  get metrics(): ReplicationMetrics {
    const keys = Object.keys(this.busy)
    const load = Object.fromEntries(keys.map((k) => [k, 0]))
    const h = this.history
    const span = h.length - 1
    if (span <= 0) return { readsPerSec: 0, writesPerSec: 0, load, errorRate: 0, staleRate: NaN, ownStaleRate: NaN, lostWrites: this.lostWrites }
    const a = h[0]
    const b = h[span]
    for (const k of keys) load[k] = (b.busy[k] - a.busy[k]) / span
    const done = b.completed - a.completed
    const dropped = b.dropped - a.dropped
    const served = b.served - a.served
    const ownServed = b.ownServed - a.ownServed
    const perSec = (n: number) => (n * TICKS_PER_SECOND) / span
    return {
      readsPerSec: perSec(b.reads - a.reads),
      writesPerSec: perSec(b.writes - a.writes),
      load,
      errorRate: done + dropped === 0 ? 0 : (dropped / (done + dropped)) * 100,
      staleRate: served === 0 ? NaN : ((b.stale - a.stale) / served) * 100,
      ownStaleRate: ownServed === 0 ? NaN : ((b.ownStale - a.ownStale) / ownServed) * 100,
      lostWrites: this.lostWrites,
    }
  }
}
