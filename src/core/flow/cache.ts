import type { FlowNode, FlowSim, Job } from './engine'

export interface CacheEntry {
  key: number
  storedAt: number // tick
  expiresAt: number // tick; Infinity = never
}

export interface CacheEvent {
  kind: 'hit' | 'evict' | 'expire'
  key: number
  jobId?: number
  tick: number
}

const EVENT_MEMORY_TICKS = 40

// A cache in front of a slower store (its first link). Each request asks for
// a key:
//   hit  → answered right here
//   miss → passed on to the store; when the store finishes it, call fill()
// It holds at most `capacity` items and evicts the least recently used.
// Items expire `ttl` ticks after they're stored. With `coalesce` on, misses
// for a key that's already being fetched wait for that fetch instead of all
// hitting the store (stops a cache stampede).
export class Cache implements FlowNode {
  alive = true
  capacity = 20
  ttl = Infinity
  coalesce = false
  hits = 0
  misses = 0
  events: CacheEvent[] = []
  // Map keeps insertion order; re-inserting on use makes the first entry the
  // least recently used.
  entries = new Map<number, CacheEntry>()
  waiting = new Map<number, Job[]>()
  private fetching = new Set<number>()
  readonly key: string

  constructor(key: string) {
    this.key = key
  }

  receive(job: Job, sim: FlowSim) {
    const store = sim.targets(this.key)[0]
    const key = job.key ?? -1
    if (!this.alive) return store ? sim.forward(job, this.key, store.key) : sim.drop(job, this.key)

    const entry = this.entries.get(key)
    if (entry && entry.expiresAt > sim.tick) {
      this.hits++
      this.entries.delete(key)
      this.entries.set(key, entry)
      this.events.push({ kind: 'hit', key, jobId: job.id, tick: sim.tick })
      return sim.complete(job)
    }
    if (entry) {
      this.entries.delete(key)
      this.events.push({ kind: 'expire', key, tick: sim.tick })
    }

    this.misses++
    if (this.coalesce && this.fetching.has(key)) {
      const list = this.waiting.get(key) ?? []
      list.push(job)
      this.waiting.set(key, list)
      return
    }
    this.fetching.add(key)
    if (store) sim.forward(job, this.key, store.key)
    else sim.drop(job, this.key)
  }

  // The store has the answer for `key`: keep it, and answer anyone waiting.
  fill(key: number, sim: FlowSim) {
    this.fetching.delete(key)
    if (this.alive && this.capacity > 0) {
      this.entries.delete(key)
      this.entries.set(key, { key, storedAt: sim.tick, expiresAt: sim.tick + this.ttl })
      this.evictOverflow(sim)
    }
    const waiters = this.waiting.get(key)
    if (waiters) {
      for (const job of waiters) sim.complete(job)
      this.waiting.delete(key)
    }
  }

  evictOverflow(sim: FlowSim) {
    while (this.entries.size > this.capacity) {
      const oldest = this.entries.keys().next().value as number
      this.entries.delete(oldest)
      this.events.push({ kind: 'evict', key: oldest, tick: sim.tick })
    }
  }

  process(sim: FlowSim) {
    this.events = this.events.filter((e) => sim.tick - e.tick <= EVENT_MEMORY_TICKS)
  }

  load() {
    let n = 0
    for (const list of this.waiting.values()) n += list.length
    return n
  }

  // A crash wipes memory: everything cached is gone, and anyone waiting on a
  // fetch is dropped.
  lose() {
    const lost = [...this.waiting.values()].flat()
    this.entries.clear()
    this.waiting.clear()
    this.fetching.clear()
    return lost
  }
}
