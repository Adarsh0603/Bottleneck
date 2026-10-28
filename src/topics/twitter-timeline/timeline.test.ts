import { describe, expect, it } from 'vitest'
import { FOLLOWERS, READERS, RETRY_NEVER, RETRY_NOW, SECOND, Timeline, type Config } from './timeline'

const rng = () => 0.5
const base = (over: Partial<Config> = {}): Config => ({
  cutoff: 1,
  thin: true,
  collapse: true,
  retry: RETRY_NOW,
  queue: true,
  caches: ['c1', 'c2'],
  servers: ['r1'],
  workers: ['fan-0', 'w1', 'w2'],
  shards: ['s0', 's1', 's2'],
  phases: [{ from: 0, opens: 20, posts: 4 }],
  stars: [],
  keys: { queue: 'q' },
  ...over,
})
const run = (tl: Timeline, seconds: number) => {
  for (let i = 0; i < seconds * SECOND; i++) tl.flow.step()
}

describe('timeline sim', () => {
  it('delivers tweets and timelines in a calm hour', () => {
    const tl = new Timeline(rng, base())
    run(tl, 20)
    expect(tl.tally.failed).toBe(0)
    expect(tl.tally.lost).toBe(0)
    expect(tl.tally.opened).toBeGreaterThan(300)
    expect(tl.tally.delivered).toBeGreaterThan(50)
  })
  it('makes a delete one write with ids, and one per follower with full copies', () => {
    const thin = new Timeline(rng, base({ thin: true }))
    const fat = new Timeline(rng, base({ thin: false }))
    expect(thin.cost('small', true)).toBe(1)
    expect(fat.cost('small', true)).toBe(FOLLOWERS.small)
    expect(fat.cost('mid', true)).toBe(FOLLOWERS.mid)
    expect(fat.cost('small', false)).toBe(FOLLOWERS.small)
  })
  it('looks a celebrity up when the cutoff says so, and writes the tweet otherwise', () => {
    expect(new Timeline(rng, base({ cutoff: 1 })).cost('star', false)).toBe(1)
    expect(new Timeline(rng, base({ cutoff: 0 })).cost('star', false)).toBe(FOLLOWERS.star)
  })
  it('tracks deletes until every copy is gone', () => {
    const tl = new Timeline(rng, base({ phases: [{ from: 0, opens: 5, posts: 2, deletes: 3 }] }))
    run(tl, 15)
    expect(tl.tally.deleted).toBeGreaterThan(30)
    expect(tl.tally.gone).toBeGreaterThan(30)
    expect(tl.tally.delLost).toBe(0)
  })
  it('empties only the first cache when it restarts', () => {
    const tl = new Timeline(rng, base({ phases: [{ from: 0, opens: 0, posts: 0 }] }))
    expect(tl.caches.map((c) => c.warm.size)).toEqual([READERS, READERS])
    tl.wipe()
    expect(tl.caches.map((c) => c.warm.size)).toEqual([0, READERS])
  })
  it('warms a timeline again after rebuilding it', () => {
    const tl = new Timeline(rng, base({ phases: [{ from: 0, opens: 10, posts: 0 }] }))
    tl.wipe()
    run(tl, 10)
    expect(tl.caches[0].warm.size).toBeGreaterThan(0)
    expect(tl.tally.failed).toBe(0)
  })
  it('sends a turned-away open again, unless told not to', () => {
    const heavy = { phases: [{ from: 0, opens: 400, posts: 0 }], shards: ['s0'], caches: [] }
    const again = new Timeline(rng, base({ ...heavy, retry: RETRY_NOW }))
    const never = new Timeline(rng, base({ ...heavy, retry: RETRY_NEVER }))
    run(again, 5)
    run(never, 5)
    expect(again.tally.retried).toBeGreaterThan(0)
    expect(never.tally.retried).toBe(0)
    expect(never.tally.failed).toBeGreaterThan(0)
  })
  it('turns writes away when a cache is jammed', () => {
    const tl = new Timeline(rng, base({ jam: ['c1', 'c2'] }))
    run(tl, 5)
    expect(tl.tally.opened).toBe(0)
  })
})
