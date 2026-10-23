import { describe, expect, it } from 'vitest'
import { Running, TICKS_PER_SECOND } from '../../core/build/run'
import type { Placement, Settings } from '../../core/build/types'
import { CELEBRITY_LAUNCH as task } from './build'

function wins(placed: Placement, settings: Settings, seed: number) {
  let x = seed
  const run = new Running(task.assemble(placed, settings, () => (x = (x * 16807) % 2147483647) / 2147483647))
  let streak = 0
  for (let t = 0; t < TICKS_PER_SECOND * 60; t++) {
    run.step()
    streak = task.check(run.metrics(), placed, settings) ? streak + 1 : 0
    if (streak >= task.holdSeconds * TICKS_PER_SECOND) return true
  }
  return false
}

const seeds = [1, 2, 3, 4, 5]
const always = (p: Placement, s: Settings) => seeds.every((seed) => wins(p, s, seed))
const never = (p: Placement, s: Settings) => seeds.every((seed) => !wins(p, s, seed))

// Pieces on the data pads, top to bottom: d = database, r = replica.
const data = (pattern: string, front?: 'cache' | 'balancer'): Placement => {
  const placed: Placement = front ? { front } : {}
  pattern.split('').forEach((c, i) => {
    if (c === 'd') placed[`data-${i}`] = 'database'
    if (c === 'r') placed[`data-${i}`] = 'replica'
  })
  return placed
}

describe('celebrity launch build', () => {
  it('replicas don’t help: every write still lands on one database', () => {
    expect(never(data('drrr', 'cache'), {})).toBe(true)
    expect(never(data('drrr'), {})).toBe(true)
  })

  it('a load balancer sends users to shards that don’t hold them', () => {
    expect(never(data('ddd', 'balancer'), {})).toBe(true)
    expect(never(data('dddr', 'balancer'), {})).toBe(true)
  })

  it('without a cache, the celebrity’s shard drowns', () => {
    expect(never(data('ddd'), {})).toBe(true)
    expect(never(data('dddr'), {})).toBe(true)
    expect(never(data('drdr'), {})).toBe(true)
  })

  it('two shards behind a cache aren’t enough on their own', () => {
    expect(never(data('dd', 'cache'), {})).toBe(true)
  })

  it('a cache plus enough shards holds', () => {
    expect(always(data('ddd', 'cache'), {})).toBe(true)
    expect(always(data('dddr', 'cache'), {})).toBe(true)
    expect(always(data('drdr', 'cache'), {})).toBe(true)
  })
})
