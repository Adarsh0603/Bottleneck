import { describe, expect, it } from 'vitest'
import { CachingSim, NODES, TICKS_PER_SECOND, topShare } from './engine'
import type { CachingState } from './types'

const ST: CachingState = { rps: 10, cache: true, capacity: 20, ttl: 0, coalesce: false, cacheDown: false, viral: false }

function seeded(seed = 1) {
  let x = seed
  return () => (x = (x * 16807) % 2147483647) / 2147483647
}

const run = (sim: CachingSim, seconds: number) => {
  for (let i = 0; i < seconds * TICKS_PER_SECOND; i++) sim.step()
}

describe('caching system', () => {
  it('sends the app straight to the database when there is no cache', () => {
    const sim = new CachingSim(seeded())
    sim.apply({ ...ST, cache: false })
    expect(sim.flow.targets(NODES.app).map((n) => n.key)).toEqual([NODES.db])
    run(sim, 10)
    expect(sim.cache.hits + sim.cache.misses).toBe(0)
  })

  it('routes through the cache when on, and around it while it is down', () => {
    const sim = new CachingSim(seeded())
    sim.apply(ST)
    expect(sim.flow.targets(NODES.app).map((n) => n.key)).toEqual([NODES.cache])
    sim.apply({ ...ST, cacheDown: true })
    expect(sim.flow.targets(NODES.app).map((n) => n.key)).toEqual([NODES.db])
  })

  it('comes back cold after a crash', () => {
    const sim = new CachingSim(seeded())
    sim.apply(ST)
    run(sim, 20)
    expect(sim.cache.entries.size).toBe(20)
    sim.apply({ ...ST, cacheDown: true })
    sim.apply(ST)
    expect(sim.cache.entries.size).toBe(0)
  })

  it('a cache takes most of the load off the database', () => {
    const without = new CachingSim(seeded())
    without.apply({ ...ST, cache: false })
    const withCache = new CachingSim(seeded())
    withCache.apply(ST)
    run(without, 30)
    run(withCache, 30)
    expect(without.metrics.dbLoad).toBeGreaterThan(0.85)
    expect(withCache.metrics.dbLoad).toBeLessThan(0.5)
    expect(withCache.metrics.hitRate).toBeGreaterThan(0.7)
  })

  it('shrinking the cache evicts down to the new size', () => {
    const sim = new CachingSim(seeded())
    sim.apply(ST)
    run(sim, 20)
    sim.apply({ ...ST, capacity: 5 })
    expect(sim.cache.entries.size).toBe(5)
  })

  it('popularity is skewed: the top 10 of 40 items get about 70% of requests', () => {
    expect(topShare(10)).toBeGreaterThan(0.65)
    expect(topShare(10)).toBeLessThan(0.72)
    expect(topShare(40)).toBeCloseTo(1)
  })
})
