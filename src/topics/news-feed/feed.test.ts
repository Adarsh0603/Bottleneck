import { describe, expect, it } from 'vitest'
import { Feed, SECOND, type Config } from './feed'

const seeded = (seed: number) => () => {
  let t = (seed += 0x6d2b79f5)
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

// A quiet start, then heavier traffic, and the celebrity posts at 30 seconds.
function run(over: Partial<Config>, seconds = 40) {
  const cfg: Config = {
    cutoff: 0,
    queue: false,
    cache: false,
    skipIdle: false,
    workers: ['w0'],
    shards: ['s0'],
    phases: [
      { from: 0, opens: 6, posts: 2, mids: 0.5 },
      { from: 20 * SECOND, opens: 60, posts: 8, mids: 0.5 },
    ],
    stars: [30 * SECOND],
    keys: { queue: 'q', cache: 'c' },
    ...over,
  }
  const feed = new Feed(seeded(7), cfg)
  for (let t = 0; t < seconds * SECOND; t++) feed.flow.step()
  return feed
}

const BIG = { queue: true, cache: true, shards: ['s0', 's1', 's2'], workers: ['w0', 'w1', 'w2'] }

describe('looking everything up', () => {
  it('turns readers away when every open needs a lookup per account', () => {
    expect(run({ cutoff: 3 }).tally.failed).toBeGreaterThan(50)
  })
  it('still turns readers away with a cache and a bigger store, in the rush', () => {
    const f = run({ cutoff: 3, cache: true, shards: ['s0', 's1', 's2'] })
    expect(f.tally.failed).toBeGreaterThan(3)
    expect(f.tally.hits).toBeGreaterThan(f.tally.opened / 3)
  })
  it('turns readers away when mid accounts are looked up too', () => {
    expect(run({ cutoff: 2, ...BIG, coldAt: 25 * SECOND }).tally.failed).toBeGreaterThan(3)
  })
})

describe('copying everything', () => {
  it('loses posts when nothing queues them', () => {
    expect(run({}).tally.lost).toBeGreaterThan(20)
  })
  it('keeps every post with a queue', () => {
    expect(run({ queue: true }).tally.lost).toBe(0)
  })
  it('buries the workers under the celebrity, less when idle followers are skipped', () => {
    const all = run({ ...BIG }).backlog()
    const active = run({ ...BIG, skipIdle: true }).backlog()
    expect(all).toBeGreaterThan(500)
    expect(active).toBeLessThan(all * 0.9)
  })
})

describe('looking up only the celebrity', () => {
  it('delivers every post at once', () => {
    const f = run({ cutoff: 1, ...BIG })
    expect(f.slowest(true)).toBeLessThan(2)
    expect(f.tally.lost).toBe(0)
    expect(f.tally.failed).toBe(0)
  })
  it('swamps the store when returning readers rebuild their feeds', () => {
    const f = run({ cutoff: 1, ...BIG, skipIdle: true }, 30)
    expect(f.storeLoad()).toBeGreaterThan(0.5)
  })
})

describe('a rate limiter', () => {
  it('turns readers away in front of the readers', () => {
    const f = run({ cutoff: 1, ...BIG, limits: [{ key: 'l', lane: 'read', rate: 30 }] })
    expect(f.tally.limited).toBeGreaterThan(100)
    expect(f.tally.failed).toBeGreaterThan(3)
  })
  it('loses posts in front of the writers', () => {
    const f = run({ cutoff: 1, ...BIG, limits: [{ key: 'l', lane: 'write', rate: 6 }] })
    expect(f.tally.lost).toBeGreaterThan(0)
  })
})

describe('the cache', () => {
  it('forgets everything when it goes cold', () => {
    const warm = run({ cutoff: 1, ...BIG }, 20).tally.hits
    const cold = run({ cutoff: 1, ...BIG, coldAt: 10 * SECOND }, 20).tally.hits
    expect(cold).toBeLessThan(warm)
  })
})
