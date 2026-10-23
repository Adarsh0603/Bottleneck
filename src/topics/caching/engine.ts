// The caching system, on the shared flow engine:
//
//   users ──▶ app servers ──▶ cache ──▶ database      (cache on)
//   users ──▶ app servers ──────────▶ database        (cache off or down)
//
// The app servers are plentiful and fast; the database is the bottleneck:
// a few slots and a slow lookup. Requests ask for items with a realistic
// skew: a few items are very popular, most are rarely asked for. That skew
// is why a small cache answers most requests.

import { Cache } from '../../core/flow/cache'
import { FlowSim } from '../../core/flow/engine'
import { Source, Worker } from '../../core/flow/nodes'
import type { CachingState } from './types'

export const TICKS_PER_SECOND = 20
export const MS_PER_TICK = 1000 / TICKS_PER_SECOND

export const ITEMS = 40 // distinct things users can ask for
export const MAX_CAPACITY = ITEMS
export const VIRAL_SHARE = 0.6 // share of traffic for the one viral item

export const NODES = { users: 'users', app: 'app', cache: 'cache', db: 'db' } as const

export const LINK_TICKS = { usersApp: 8, appCache: 5, cacheDb: 6, appDb: 10 }

const DB_LOOKUP = 15 // ticks per lookup per slot: 4 slots ≈ 5.3 lookups/s
const VIRAL_LOOKUP = 45 // the viral item is expensive to build, e.g. a home feed
const WINDOW = TICKS_PER_SECOND * 3

// Popularity follows a Zipf curve: item k is asked for ~1/(k+1) as often as
// the most popular one. Precomputed as a cumulative table.
function zipfTable(n: number) {
  const weights = Array.from({ length: n }, (_, k) => 1 / (k + 1))
  const total = weights.reduce((a, b) => a + b, 0)
  let sum = 0
  return weights.map((w) => (sum += w / total))
}
const ZIPF = zipfTable(ITEMS)
const ZIPF_REST = zipfTable(ITEMS - 1)

const pick = (table: number[], r: number) => {
  const i = table.findIndex((c) => r < c)
  return i < 0 ? table.length - 1 : i
}

// Which item a request asks for, following the popularity curve.
export const popularItem = (rng: () => number) => pick(ZIPF, rng())

// The share of requests the `n` most popular items get (no viral item).
export const topShare = (n: number) => (n <= 0 ? 0 : ZIPF[Math.min(n, ITEMS) - 1])

export interface CachingMetrics {
  hitRate: number // 0–1 over the last few seconds; NaN with no lookups
  dropRate: number // percent
  dbLoad: number // 0–1: how busy the database's slots were
  avgMs: number
}

interface Sample {
  completed: number
  dropped: number
  hits: number
  misses: number
  dbBusy: number
}

export class CachingSim {
  readonly flow: FlowSim
  readonly users: Source
  readonly app: Worker
  readonly cache: Cache
  readonly db: Worker
  private viral = false
  private cacheInPath = false
  private history: Sample[] = []

  constructor(rng: () => number = Math.random) {
    this.flow = new FlowSim(rng)
    this.users = this.flow.add(new Source(NODES.users))
    this.users.keyOf = (r) => {
      if (!this.viral) return pick(ZIPF, r())
      const x = r()
      return x < VIRAL_SHARE ? 0 : 1 + pick(ZIPF_REST, (x - VIRAL_SHARE) / (1 - VIRAL_SHARE))
    }
    this.app = this.flow.add(new Worker(NODES.app, { slots: 32, queueLimit: 64, workPerRequest: 2 }))
    this.cache = this.flow.add(new Cache(NODES.cache))
    this.db = this.flow.add(new Worker(NODES.db, { slots: 4, queueLimit: 8, workPerRequest: DB_LOOKUP }))
    this.db.workOf = (job) => (this.viral && job.key === 0 ? VIRAL_LOOKUP : DB_LOOKUP)
    this.db.onFinish = (job, sim) => {
      if (this.cacheInPath && job.key !== undefined) this.cache.fill(job.key, sim)
    }
    this.flow.link(NODES.users, NODES.app, LINK_TICKS.usersApp)
    this.flow.link(NODES.cache, NODES.db, LINK_TICKS.cacheDb)
  }

  get tick() {
    return this.flow.tick
  }

  // Make the system match the state a beat or control describes.
  apply(st: CachingState) {
    this.users.rate = st.rps / TICKS_PER_SECOND
    this.viral = st.viral

    // Crash or restart the cache. A restarted cache is empty ("cold").
    if (st.cacheDown && this.cache.alive) this.flow.fail(NODES.cache)
    this.cache.alive = !st.cacheDown

    this.cache.capacity = st.capacity
    this.cache.ttl = st.ttl > 0 ? st.ttl * TICKS_PER_SECOND : Infinity
    this.cache.coalesce = st.coalesce
    this.cache.evictOverflow(this.flow)
    for (const entry of this.cache.entries.values()) entry.expiresAt = entry.storedAt + this.cache.ttl

    // Route the app through the cache only while it's on and up.
    const through = st.cache && !st.cacheDown
    if (through !== this.cacheInPath || this.flow.targets(NODES.app).length === 0) {
      this.flow.unlink(NODES.app, NODES.cache)
      this.flow.unlink(NODES.app, NODES.db)
      if (through) this.flow.link(NODES.app, NODES.cache, LINK_TICKS.appCache)
      else this.flow.link(NODES.app, NODES.db, LINK_TICKS.appDb)
      this.cacheInPath = through
    }
  }

  step() {
    this.flow.step()
    this.history.push({
      completed: this.flow.stats.completed,
      dropped: this.flow.stats.dropped,
      hits: this.cache.hits,
      misses: this.cache.misses,
      dbBusy: this.db.active.length / this.db.slots,
    })
    if (this.history.length > WINDOW + 1) this.history.shift()
  }

  // Rolling numbers over the last few seconds, so they recover after a fix.
  get metrics(): CachingMetrics {
    const h = this.history
    if (h.length < 2) return { hitRate: NaN, dropRate: 0, dbLoad: 0, avgMs: 0 }
    const first = h[0]
    const last = h[h.length - 1]
    const completed = last.completed - first.completed
    const dropped = last.dropped - first.dropped
    const hits = last.hits - first.hits
    const misses = last.misses - first.misses
    return {
      hitRate: hits + misses === 0 ? NaN : hits / (hits + misses),
      dropRate: completed + dropped === 0 ? 0 : (dropped / (completed + dropped)) * 100,
      dbLoad: h.slice(1).reduce((sum, s) => sum + s.dbBusy, 0) / (h.length - 1),
      avgMs: this.flow.avgLatency() * MS_PER_TICK,
    }
  }
}
