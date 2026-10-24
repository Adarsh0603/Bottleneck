// CAP, on the shared flow engine:
//
//   users ─▶ West database ┄┄ link ┄┄ East database ◀─ users
//
// Both regions take reads and writes from their own users, and ship each
// write to the other region a moment later. While the link is cut, nothing
// ships. What each region does about it is the `mode`:
//   - consistent: East, the side cut off from the primary, turns its users
//     away rather than answer something it can't confirm. West carries on.
//   - available: both regions keep answering. East serves old data, and a
//     write on each side to the same item leaves two versions to settle
//     once the link is back.

import { FlowSim, type FlowNode, type Job } from '../../core/flow/engine'
import { Worker } from '../../core/flow/nodes'
import type { CapState, Mode } from './types'
import { dbKey, other, REGIONS, TICKS_PER_SECOND, usersKey, type Region } from './world'

export type Kind = 'read' | 'write'

const ITEMS = 12
const WRITE_SHARE = 0.2
const READ_WORK = 6
const WRITE_WORK = 8
export const LINK_TICKS = { usersDb: 8, replicate: 6 }
const WINDOW = TICKS_PER_SECOND * 3
const EVENT_MEMORY = TICKS_PER_SECOND * 2

// Users send reads and writes to their region's database.
class Users implements FlowNode {
  alive = true
  rate = 0 // requests per tick
  readonly key: string
  private carry = 0
  private region: Region
  private cap: CapSim

  constructor(region: Region, cap: CapSim) {
    this.region = region
    this.key = usersKey(region)
    this.cap = cap
  }

  receive(job: Job, sim: FlowSim) {
    sim.complete(job)
  }

  emit(sim: FlowSim) {
    this.carry += this.rate
    while (this.carry >= 1) {
      this.carry -= 1
      const write = sim.rng() < WRITE_SHARE
      const job = sim.newJob(1, Math.floor(sim.rng() * ITEMS), this.key)
      this.cap.kindOf.set(job, write ? 'write' : 'read')
      this.cap.sent[write ? 'writes' : 'reads']++
      if (this.region === 'east') this.cap.east.sent++
      if (this.cap.refuses(this.region)) {
        if (this.region === 'east') this.cap.east.refused++
        sim.drop(job, dbKey(this.region))
      } else sim.forward(job, this.key, dbKey(this.region))
    }
  }
}

// A write on its way to the other region.
export interface Shipment {
  to: Region
  item: number
  version: number
  sentAt: number
  arrive: number
}

export interface CapMetrics {
  readsPerSec: number
  writesPerSec: number
  load: Record<Region, number> // how busy each database's slots were, 0–1
  errorRate: number // percent of requests turned away
  staleRate: number // percent of reads answered with old data; NaN with no reads
  eastErrorRate: number // the same two, for East's users alone
  eastStaleRate: number
  conflicts: number // items written on both sides during the split
}

interface Sample {
  completed: number
  dropped: number
  reads: number
  writes: number
  served: number
  stale: number
  east: { sent: number; refused: number; served: number; stale: number }
  busy: Record<Region, number>
}

export class CapSim {
  readonly flow: FlowSim
  readonly dbs = {} as Record<Region, Worker>
  readonly kindOf = new WeakMap<Job, Kind>()
  readonly sent = { reads: 0, writes: 0 }
  shipping: Shipment[] = []
  staleEvents: { node: Region; tick: number }[] = []

  private users = {} as Record<Region, Users>
  private partitioned = false
  private mode: Mode = 'consistent'
  private versions: Record<Region, Int32Array> = { west: new Int32Array(ITEMS), east: new Int32Array(ITEMS) }
  private dirty: Record<Region, Set<number>> = { west: new Set(), east: new Set() }
  private settled = 0 // conflicts the last heal had to settle
  private served = 0
  private stale = 0
  east = { sent: 0, refused: 0, served: 0, stale: 0 }
  private busy: Record<Region, number> = { west: 0, east: 0 }
  private history: Sample[] = []

  constructor(rng: () => number = Math.random) {
    this.flow = new FlowSim(rng)
    for (const r of REGIONS) {
      this.users[r] = this.flow.add(new Users(r, this))
      const w = this.flow.add(new Worker(dbKey(r), { slots: 4, queueLimit: 8 }))
      w.workOf = (job) => (this.kindOf.get(job) === 'write' ? WRITE_WORK : READ_WORK)
      w.onFinish = (job, sim) => this.finished(r, job, sim)
      this.flow.link(usersKey(r), dbKey(r), LINK_TICKS.usersDb)
      this.dbs[r] = w
    }
  }

  get tick() {
    return this.flow.tick
  }

  // East is the side cut off from the primary: it turns users away when
  // consistency matters more than answering.
  refuses(region: Region) {
    return this.partitioned && this.mode === 'consistent' && region === 'east'
  }

  apply(st: CapState) {
    for (const r of REGIONS) this.users[r].rate = st.rps / TICKS_PER_SECOND
    this.mode = st.mode
    if (st.partitioned === this.partitioned) return
    this.partitioned = st.partitioned
    if (st.partitioned) {
      // Changes still on the wire never arrive.
      this.shipping = []
      this.dirty = { west: new Set(), east: new Set() }
      return
    }
    // The link is back: both sides settle on the newest version of everything.
    this.settled = this.conflictCount()
    this.dirty = { west: new Set(), east: new Set() }
    for (let i = 0; i < ITEMS; i++) {
      const v = Math.max(this.versions.west[i], this.versions.east[i])
      this.versions.west[i] = v
      this.versions.east[i] = v
    }
  }

  private conflictCount() {
    let n = 0
    for (const i of this.dirty.west) if (this.dirty.east.has(i)) n++
    return n
  }

  private finished(region: Region, job: Job, sim: FlowSim) {
    const item = job.key ?? 0
    const v = this.versions[region]
    if (this.kindOf.get(job) === 'write') {
      const version = ++v[item]
      if (this.partitioned) this.dirty[region].add(item)
      else this.shipping.push({ to: other(region), item, version, sentAt: sim.tick, arrive: sim.tick + LINK_TICKS.replicate })
      return
    }
    // A read is stale when the other side has something newer that isn't
    // simply on its way yet.
    const behind = v[item] < this.versions[other(region)][item]
    const onItsWay = this.shipping.some((s) => s.to === region && s.item === item)
    this.served++
    if (region === 'east') this.east.served++
    if (!behind || onItsWay) return
    this.stale++
    if (region === 'east') this.east.stale++
    this.staleEvents.push({ node: region, tick: sim.tick })
  }

  step() {
    this.flow.step()
    const t = this.flow.tick
    for (const s of this.shipping) {
      if (s.arrive > t) continue
      const v = this.versions[s.to]
      v[s.item] = Math.max(v[s.item], s.version)
    }
    this.shipping = this.shipping.filter((s) => s.arrive > t)
    this.staleEvents = this.staleEvents.filter((e) => t - e.tick <= EVENT_MEMORY)

    for (const r of REGIONS) this.busy[r] += this.dbs[r].active.length / this.dbs[r].slots
    this.history.push({
      completed: this.flow.stats.completed,
      dropped: this.flow.stats.dropped,
      reads: this.sent.reads,
      writes: this.sent.writes,
      served: this.served,
      stale: this.stale,
      east: { ...this.east },
      busy: { ...this.busy },
    })
    if (this.history.length > WINDOW + 1) this.history.shift()
  }

  get metrics(): CapMetrics {
    const conflicts = this.partitioned ? this.conflictCount() : this.settled
    const h = this.history
    const span = h.length - 1
    if (span <= 0) return { readsPerSec: 0, writesPerSec: 0, load: { west: 0, east: 0 }, errorRate: 0, staleRate: NaN, eastErrorRate: 0, eastStaleRate: NaN, conflicts }
    const a = h[0]
    const b = h[span]
    const done = b.completed - a.completed
    const dropped = b.dropped - a.dropped
    const served = b.served - a.served
    const e = { sent: b.east.sent - a.east.sent, refused: b.east.refused - a.east.refused, served: b.east.served - a.east.served, stale: b.east.stale - a.east.stale }
    const perSec = (n: number) => (n * TICKS_PER_SECOND) / span
    return {
      readsPerSec: perSec(b.reads - a.reads),
      writesPerSec: perSec(b.writes - a.writes),
      load: { west: (b.busy.west - a.busy.west) / span, east: (b.busy.east - a.busy.east) / span },
      errorRate: done + dropped === 0 ? 0 : (dropped / (done + dropped)) * 100,
      staleRate: served === 0 ? NaN : ((b.stale - a.stale) / served) * 100,
      eastErrorRate: e.sent === 0 ? 0 : (e.refused / e.sent) * 100,
      eastStaleRate: e.served === 0 ? NaN : (e.stale / e.served) * 100,
      conflicts,
    }
  }
}
