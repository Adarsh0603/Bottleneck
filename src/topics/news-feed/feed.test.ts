import { describe, expect, it } from 'vitest'
import { Feed, SECOND, type Config, type Mode } from './feed'

const seeded = (seed: number) => () => {
  let t = (seed += 0x6d2b79f5)
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

// A quiet start, then heavier traffic, and the celebrity posts at 30 seconds.
function run(over: Partial<Config> & { mode: Mode }, seconds = 40) {
  const cfg: Config = {
    queue: false,
    cache: false,
    skipIdle: false,
    workers: ['w0'],
    shards: ['s0'],
    phases: [
      { from: 0, opens: 6, posts: 2 },
      { from: 20 * SECOND, opens: 60, posts: 8 },
    ],
    stars: [30 * SECOND],
    keys: { queue: 'q', cache: 'c' },
    ...over,
  }
  const feed = new Feed(seeded(7), cfg)
  for (let t = 0; t < seconds * SECOND; t++) feed.flow.step()
  return feed
}

const BIG = { queue: true, cache: true, shards: ['s0', 's1'], workers: ['w0', 'w1', 'w2'] }

describe('reading', () => {
  it('turns readers away when every open needs a lookup per account', () => {
    expect(run({ mode: 'read' }).tally.failed).toBeGreaterThan(50)
  })
  it('still turns readers away with a cache, in the rush', () => {
    const f = run({ mode: 'read', cache: true, shards: ['s0', 's1'] })
    expect(f.tally.failed).toBeGreaterThan(3)
    expect(f.tally.hits).toBeGreaterThan(f.tally.opened / 3)
  })
})

describe('writing', () => {
  it('loses posts when nothing queues them', () => {
    expect(run({ mode: 'write' }).tally.lost).toBeGreaterThan(20)
  })
  it('keeps every post with a queue', () => {
    expect(run({ mode: 'write', queue: true }).tally.lost).toBe(0)
  })
  it('buries the workers under the celebrity, less when idle followers are skipped', () => {
    const all = run({ mode: 'write', ...BIG }).backlog()
    const active = run({ mode: 'write', ...BIG, skipIdle: true }).backlog()
    expect(all).toBeGreaterThan(1000)
    expect(active).toBeLessThan(all * 0.7)
  })
})

describe('hybrid', () => {
  it('delivers the celebrity at once', () => {
    const f = run({ mode: 'hybrid', ...BIG })
    expect(f.slowest(true)).toBeLessThan(2)
    expect(f.tally.lost).toBe(0)
    expect(f.tally.failed).toBe(0)
  })
})

describe('the cache', () => {
  it('forgets everything when it goes cold', () => {
    const warm = run({ mode: 'read', ...BIG }, 20).tally.hits
    const cold = run({ mode: 'read', ...BIG, coldAt: 10 * SECOND }, 20).tally.hits
    expect(cold).toBeLessThan(warm)
  })
})
