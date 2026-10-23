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
import { pick, zipfTable } from '../../core/flow/popularity'
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
const STALE_WINDOW = TICKS_PER_SECOND * 8 // stale answers come in waves; judge them over longer

// Each item's TTL is stretched or shrunk a little (75–125%), so items cached
// together don't all expire together and hit the database in one wave.
const jitter = (key: number) => 0.75 + ((key * 37) % 11) / 20
export const FILL_TICKS = 12 // how long an answer takes to fly back into the cache

const ZIPF = zipfTable(ITEMS)
const ZIPF_REST = zipfTable(ITEMS - 1)

// Which item a request asks for, following the popularity curve.
export const popularItem = (rng: () => number) => pick(ZIPF, rng())

// The share of requests item `k` gets on its own (no viral item).
export const share = (k: number) => ZIPF[k] - (k > 0 ? ZIPF[k - 1] : 0)

// The share of requests the `n` most popular items get (no viral item).
export const topShare = (n: number) => (n <= 0 ? 0 : ZIPF[Math.min(n, ITEMS) - 1])

export interface CachingMetrics {
  hitRate: number // 0–1 over the last few seconds; NaN with no lookups
  dropRate: number // percent
  dbLoad: number // 0–1: how busy the database's slots were
  avgMs: number
  staleRate: number // percent of answers that were an outdated cached copy; NaN with none
}

interface Sample {
  completed: number
  dropped: number
  hits: number
  misses: number
  stale: number
  dbBusy: number
}

export class CachingSim {
  readonly flow: FlowSim
  readonly users: Source
  readonly app: Worker
  readonly cache: Cache
  readonly db: Worker
  // Answers on their way back from the database to fill the cache (for drawing).
  fills: { key: number; jobId: number; tick: number }[] = []
  // The data changes in the database over time. Each item has a version; the
  // cache remembers the version it copied. A hit on an older copy is stale.
  readonly versions = new Int32Array(ITEMS)
  readonly cachedVersion = new Map<number, number>()
  staleHits: { key: number; jobId: number; tick: number }[] = []
  private stale = 0
  private changes = 0 // per tick
  private ttlSetAt = 0
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
      if (!this.cacheInPath || job.key === undefined) return
      this.cache.fill(job.key, sim)
      const entry = this.cache.entries.get(job.key)
      if (entry) entry.expiresAt = entry.storedAt + this.cache.ttl * jitter(job.key)
      this.cachedVersion.set(job.key, this.versions[job.key])
      this.fills.push({ key: job.key, jobId: job.id, tick: sim.tick })
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
    this.changes = st.changes / TICKS_PER_SECOND

    // Crash or restart the cache. A restarted cache is empty ("cold").
    if (st.cacheDown && this.cache.alive) this.flow.fail(NODES.cache)
    this.cache.alive = !st.cacheDown

    this.cache.capacity = st.capacity
    const ttl = st.ttl > 0 ? st.ttl * TICKS_PER_SECOND : Infinity
    if (ttl !== this.cache.ttl) this.ttlSetAt = this.flow.tick
    this.cache.ttl = ttl
    this.cache.coalesce = st.coalesce
    this.cache.evictOverflow(this.flow)
    for (const entry of this.cache.entries.values()) entry.expiresAt = entry.storedAt + this.cache.ttl * jitter(entry.key)

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
    const t = this.flow.tick
    this.fills = this.fills.filter((f) => t - f.tick <= FILL_TICKS)

    // Popular items change more often too (a busy profile, a live score).
    if (this.changes > 0 && this.flow.rng() < this.changes) this.versions[pick(ZIPF, this.flow.rng())]++
    for (const e of this.cache.events) {
      if (e.kind !== 'hit' || e.tick !== t) continue
      if ((this.cachedVersion.get(e.key) ?? 0) < this.versions[e.key]) {
        this.stale++
        this.staleHits.push({ key: e.key, jobId: e.jobId ?? 0, tick: t })
      }
    }
    this.staleHits = this.staleHits.filter((s) => t - s.tick <= TICKS_PER_SECOND)
    this.history.push({
      completed: this.flow.stats.completed,
      dropped: this.flow.stats.dropped,
      hits: this.cache.hits,
      misses: this.cache.misses,
      stale: this.stale,
      dbBusy: this.db.active.length / this.db.slots,
    })
    if (this.history.length > STALE_WINDOW + 1) this.history.shift()
  }

  // Has every cached copy been around for a full TTL since it last changed?
  // Only then do the stale numbers show what this TTL really gives.
  get ttlSettled() {
    return Number.isFinite(this.cache.ttl) && this.flow.tick - this.ttlSetAt >= this.cache.ttl
  }

  // Rolling numbers over the last few seconds, so they recover after a fix.
  get metrics(): CachingMetrics {
    const all = this.history
    const h = all.slice(-(WINDOW + 1))
    if (h.length < 2) return { hitRate: NaN, dropRate: 0, dbLoad: 0, avgMs: 0, staleRate: NaN }
    const first = h[0]
    const last = h[h.length - 1]
    const answered = last.completed - all[0].completed
    const completed = last.completed - first.completed
    const dropped = last.dropped - first.dropped
    const hits = last.hits - first.hits
    const misses = last.misses - first.misses
    return {
      hitRate: hits + misses === 0 ? NaN : hits / (hits + misses),
      dropRate: completed + dropped === 0 ? 0 : (dropped / (completed + dropped)) * 100,
      dbLoad: h.slice(1).reduce((sum, s) => sum + s.dbBusy, 0) / (h.length - 1),
      avgMs: this.flow.avgLatency() * MS_PER_TICK,
      staleRate: answered === 0 ? NaN : ((last.stale - all[0].stale) / answered) * 100,
    }
  }
}
