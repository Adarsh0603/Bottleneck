// The CDN system, on the shared flow engine:
//
//   users (US)     ──────────────────────▶ origin
//   users (Europe) ──▶ [edge] ───────────▶ origin
//   users (Asia)   ──▶ [edge] ───────────▶ origin
//
// Each region's users ask for files (popular ones far more than others). An
// edge server near them is a cache: a hit is answered next door, a miss
// travels all the way to the origin and fills the edge on the way back.

import { Cache } from '../../core/flow/cache'
import { FlowSim } from '../../core/flow/engine'
import { Source, Worker } from '../../core/flow/nodes'
import { pick, zipfTable } from '../../core/flow/popularity'
import type { CdnState } from './types'
import { edgeKey, edgeSpot, MS_PER_TICK, ORIGIN, REGIONS, regionOf, TICKS_PER_SECOND, travelTicks, usersKey, type RegionId } from './world'

const FILES = 40
const POPULAR = zipfTable(FILES)
const LATENCY_SAMPLES = 40
const WINDOW = TICKS_PER_SECOND * 3

export interface CdnMetrics {
  latency: Record<RegionId, number> // recent average response per region, ms
  hitRate: number // edges only; NaN with no edge lookups
  originRps: number // requests reaching the origin per second
}

export class CdnSim {
  readonly flow: FlowSim
  readonly origin: Worker
  readonly edges = {} as Record<RegionId, Cache>
  private users = {} as Record<RegionId, Source>
  private on = { us: false, eu: false, asia: false }
  private purge = 0
  private latencies = { us: [], eu: [], asia: [] } as Record<RegionId, number[]>
  private history: { served: number; hits: number; misses: number }[] = []

  constructor(rng: () => number = Math.random) {
    this.flow = new FlowSim(rng)
    this.origin = this.flow.add(new Worker('origin', { slots: 8, queueLimit: 32, workPerRequest: 4 }))
    for (const r of REGIONS) {
      const users = this.flow.add(new Source(usersKey(r.id)))
      users.keyOf = (rand) => pick(POPULAR, rand())
      this.users[r.id] = users
      const edge = this.flow.add(new Cache(edgeKey(r.id)))
      edge.capacity = 20
      this.edges[r.id] = edge
      this.flow.link(edgeKey(r.id), 'origin', travelTicks(edgeSpot(r.id), ORIGIN))
      this.flow.link(usersKey(r.id), 'origin', travelTicks(r, ORIGIN))
    }
    // A miss fills the edge of the region that asked.
    this.origin.onFinish = (job, sim) => {
      const region = regionOf(job.from)
      if (region && this.on[region] && job.key !== undefined) this.edges[region].fill(job.key, sim)
    }
    this.flow.onComplete = (job, ticks) => {
      const region = regionOf(job.from)
      if (!region) return
      const list = this.latencies[region]
      list.push(ticks)
      if (list.length > LATENCY_SAMPLES) list.shift()
    }
  }

  get tick() {
    return this.flow.tick
  }

  apply(st: CdnState) {
    for (const r of REGIONS) {
      this.users[r.id].rate = st.rps / TICKS_PER_SECOND
      const on = st.edges[r.id]
      if (on === this.on[r.id]) continue
      // Users go through their edge when there is one, else straight to the origin.
      this.flow.unlink(usersKey(r.id), 'origin')
      this.flow.unlink(usersKey(r.id), edgeKey(r.id))
      if (on) this.flow.link(usersKey(r.id), edgeKey(r.id), travelTicks(r, edgeSpot(r.id)))
      else this.flow.link(usersKey(r.id), 'origin', travelTicks(r, ORIGIN))
      this.on[r.id] = on
    }
    // A purge empties every edge: the next requests go back to the origin.
    if (st.purge !== this.purge) {
      for (const edge of Object.values(this.edges)) edge.entries.clear()
      this.purge = st.purge
    }
  }

  edgeOn(id: RegionId) {
    return this.on[id]
  }

  step() {
    this.flow.step()
    const edges = Object.values(this.edges)
    this.history.push({
      served: this.origin.served,
      hits: edges.reduce((sum, e) => sum + e.hits, 0),
      misses: edges.reduce((sum, e) => sum + e.misses, 0),
    })
    if (this.history.length > WINDOW + 1) this.history.shift()
  }

  get metrics(): CdnMetrics {
    const avg = (list: number[]) => (list.length === 0 ? 0 : (list.reduce((a, b) => a + b, 0) / list.length) * MS_PER_TICK)
    const h = this.history
    const first = h[0]
    const last = h[h.length - 1]
    const span = h.length - 1
    const hits = span > 0 ? last.hits - first.hits : 0
    const misses = span > 0 ? last.misses - first.misses : 0
    return {
      latency: { us: avg(this.latencies.us), eu: avg(this.latencies.eu), asia: avg(this.latencies.asia) },
      hitRate: hits + misses === 0 ? NaN : hits / (hits + misses),
      originRps: span > 0 ? ((last.served - first.served) * TICKS_PER_SECOND) / span : 0,
    }
  }
}
