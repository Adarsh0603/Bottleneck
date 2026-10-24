import { describe, expect, it } from 'vitest'
import { Running, TICKS_PER_SECOND } from '../../core/build/run'
import type { Placement, Settings } from '../../core/build/types'
import { SAVE_THE_DATABASE as task } from './build'

function wins(placed: Placement, settings: Settings, seed: number) {
  let x = seed
  const run = new Running(task.assemble(placed, settings, () => (x = (x * 16807) % 2147483647) / 2147483647))
  let streak = 0
  for (let t = 0; t < TICKS_PER_SECOND * 120; t++) {
    run.step()
    streak = task.check(run.metrics(), placed, settings, run.flow) ? streak + 1 : 0
    if (streak >= task.holdSeconds * TICKS_PER_SECOND) return true
  }
  return false
}

const seeds = [1, 2, 3, 4, 5]
const always = (p: Placement, s: Settings) => seeds.every((seed) => wins(p, s, seed))
const never = (p: Placement, s: Settings) => seeds.every((seed) => !wins(p, s, seed))
const cache: Placement = { middle: 'cache' }
const FOREVER = 3

describe('save the database build', () => {
  it('a build that works never turns requests away', () => {
    let x = 7
    const run = new Running(task.assemble(cache, { size: 30, keep: 1 }, () => (x = (x * 16807) % 2147483647) / 2147483647))
    for (let t = 0; t < TICKS_PER_SECOND * 60; t++) run.step()
    expect(run.flow.stats.dropped).toBe(0)
  })

  it('nothing in between: the database drowns', () => {
    expect(never({}, { size: 5, keep: FOREVER })).toBe(true)
  })

  it('a server in between only passes requests through', () => {
    expect(never({ middle: 'server' }, { size: 5, keep: FOREVER })).toBe(true)
  })

  it('a cache only helps once it can hold the popular items', () => {
    expect(never(cache, { size: 5, keep: 1 })).toBe(true)
    expect(always(cache, { size: 30, keep: 1 })).toBe(true)
  })

  it('keeping items forever shows old prices', () => {
    expect(never(cache, { size: 40, keep: FOREVER })).toBe(true)
  })

  it('throwing items away after 3 seconds sends the database too much work', () => {
    expect(never(cache, { size: 40, keep: 0 })).toBe(true)
  })
})
