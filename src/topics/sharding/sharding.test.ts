import { describe, expect, it } from 'vitest'
import { stateAt } from '../../core/chapters'
import { CHAPTERS } from './chapters'
import { holdsOf, ShardingSim } from './engine'
import type { ShardingState } from './types'
import { TICKS_PER_SECOND } from './world'

const seeded = (seed: number) => {
  let x = seed
  return () => (x = (x * 16807) % 2147483647) / 2147483647
}
const seeds = [1, 2, 3, 4, 5]
const EXTRAS = { celebrity: false, cached: false, down: null }

function run(st: ShardingState, seconds: number, seed = 1, sim = new ShardingSim(seeded(seed))) {
  sim.apply(st)
  for (let t = 0; t < TICKS_PER_SECOND * seconds; t++) sim.step()
  return sim
}

describe('sharding system', () => {
  it('one database drowns under heavy traffic; shards share it', () => {
    expect(run({ rps: 8, shards: 1, key: 'name', ...EXTRAS }, 30).metrics.errorRate).toBeGreaterThan(5)
    expect(run({ rps: 8, shards: 2, key: 'name', ...EXTRAS }, 30).metrics.errorRate).toBeLessThan(1)
  })

  it('signup order and names both bunch users up; a hash spreads them', () => {
    for (const seed of seeds) {
      const at = (key: ShardingState['key']) => run({ rps: 20, shards: 4, key, ...EXTRAS }, 30, seed).metrics
      const signup = at('signup')
      expect(signup.load['shard-3']).toBeGreaterThan(0.85)
      expect(signup.load['shard-0']).toBeLessThan(0.4)
      const name = at('name')
      expect(name.maxLoad).toBeGreaterThan(0.85)
      expect(name.load['shard-3']).toBeLessThan(0.25) // U–Z
      expect(at('hash').errorRate).toBeLessThan(1)
    }
  })

  it('a celebrity overloads their shard until cached; a dead shard fails only its users', () => {
    const st: ShardingState = { rps: 14, shards: 4, key: 'hash', ...EXTRAS }
    for (const seed of seeds) {
      expect(run({ ...st, celebrity: true }, 30, seed).metrics.load['shard-2']).toBeGreaterThan(0.85)
      expect(run({ ...st, celebrity: true, cached: true }, 30, seed).metrics.maxLoad).toBeLessThan(0.85)
      const down = run({ ...st, down: 1 }, 30, seed).metrics.errorRate
      expect(down).toBeGreaterThan(8)
      expect(down).toBeLessThan(40)
    }
  })

  it('labels each shard with what it holds', () => {
    expect([0, 1].map((i) => holdsOf(i, 2, 'name'))).toEqual(['A–M', 'N–Z'])
    expect(holdsOf(3, 4, 'signup')).toBe('#751–1000')
  })
})

// A chapter's challenge, run exactly as the player checks it.
function solves(title: string, change: Partial<ShardingState>, seed: number) {
  const chapter = CHAPTERS.find((c) => c.title === title)!
  const beatIdx = chapter.beats.findIndex((b) => b.challenge)
  const challenge = chapter.beats[beatIdx].challenge!
  const st = { ...stateAt(chapter, beatIdx), ...change }
  const sim = new ShardingSim(seeded(seed))
  sim.apply(st)
  let streak = 0
  for (let t = 0; t < TICKS_PER_SECOND * 60; t++) {
    sim.step()
    streak = challenge.check({ m: sim.metrics, st, sim }) ? streak + 1 : 0
    if (streak >= challenge.holdSeconds * TICKS_PER_SECOND) return true
  }
  return false
}

describe('shards challenge', () => {
  it('needs enough shards', () => {
    expect(seeds.every((s) => !solves('Split by user', { shards: 1 }, s))).toBe(true)
    expect(seeds.every((s) => !solves('Split by user', { shards: 2 }, s))).toBe(true)
    expect(seeds.every((s) => solves('Split by user', { shards: 4 }, s))).toBe(true)
  })
})

describe('shard key challenge', () => {
  it('is solved only by a hashed id', () => {
    expect(seeds.every((s) => solves('Hot spots', { key: 'hash' }, s))).toBe(true)
    expect(seeds.every((s) => !solves('Hot spots', { key: 'signup' }, s))).toBe(true)
    expect(seeds.every((s) => !solves('Hot spots', { key: 'name' }, s))).toBe(true)
  })
})
