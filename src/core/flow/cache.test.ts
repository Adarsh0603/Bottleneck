import { describe, expect, it } from 'vitest'
import { Cache } from './cache'
import { FlowSim } from './engine'
import { Worker } from './nodes'

// cache ──▶ db, with the db filling the cache as it answers.
function setup() {
  const sim = new FlowSim(() => 0)
  const cache = sim.add(new Cache('cache'))
  const db = sim.add(new Worker('db', { workPerRequest: 1 }))
  sim.link('cache', 'db', 0)
  db.onFinish = (job, s) => cache.fill(job.key!, s)
  const ask = (key: number) => sim.deliver(sim.newJob(1, key), 'cache')
  return { sim, cache, db, ask }
}

describe('cache', () => {
  it('misses the first time, then hits once the store has answered', () => {
    const { sim, cache, ask } = setup()
    ask(7)
    expect(cache.misses).toBe(1)
    sim.step() // db answers and fills the cache
    ask(7)
    expect(cache.hits).toBe(1)
    expect(sim.stats.completed).toBe(2)
  })

  it('evicts the least recently used item when full', () => {
    const { sim, cache, ask } = setup()
    cache.capacity = 2
    for (const k of [1, 2]) {
      ask(k)
      sim.step()
    }
    ask(1) // 1 is now the most recently used
    ask(3)
    sim.step()
    expect([...cache.entries.keys()]).toEqual([1, 3])
    expect(cache.events.some((e) => e.kind === 'evict' && e.key === 2)).toBe(true)
  })

  it('treats an expired item as a miss', () => {
    const { sim, cache, ask } = setup()
    cache.ttl = 3
    ask(5)
    sim.step()
    for (let i = 0; i < 3; i++) sim.step()
    ask(5)
    expect(cache.misses).toBe(2)
    expect(cache.events.some((e) => e.kind === 'expire')).toBe(true)
  })

  it('without coalescing, every miss for the same key goes to the store', () => {
    const { cache, db, ask } = setup()
    for (let i = 0; i < 5; i++) ask(9)
    expect(db.load()).toBe(5)
    expect(cache.load()).toBe(0)
  })

  it('with coalescing, one fetch goes out and the rest wait for it', () => {
    const { sim, cache, db, ask } = setup()
    cache.coalesce = true
    for (let i = 0; i < 5; i++) ask(9)
    expect(db.load()).toBe(1)
    expect(cache.load()).toBe(4)
    sim.step()
    expect(cache.load()).toBe(0)
    expect(sim.stats.completed).toBe(5)
  })

  it('a crash empties the cache and drops anyone waiting', () => {
    const { sim, cache, ask } = setup()
    cache.coalesce = true
    ask(1)
    sim.step()
    for (let i = 0; i < 3; i++) ask(2)
    sim.fail('cache')
    expect(cache.entries.size).toBe(0)
    expect(sim.stats.dropped).toBe(2)
  })
})
