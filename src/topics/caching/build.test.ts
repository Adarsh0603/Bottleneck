import { describe, expect, it } from 'vitest'
import { Running, TICKS_PER_SECOND } from '../../core/build/run'
import type { Placement, Settings } from '../../core/build/types'
import { SAVE_THE_DATABASE as task } from './build'

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

describe('save the database build', () => {
  it('nothing in between: the database drowns', () => {
    expect(never({}, { size: 5 })).toBe(true)
  })

  it('a server in between only passes requests through', () => {
    expect(never({ middle: 'server' }, { size: 5 })).toBe(true)
  })

  it('a cache only helps once it can hold the popular items', () => {
    expect(never({ middle: 'cache' }, { size: 5 })).toBe(true)
    expect(always({ middle: 'cache' }, { size: 20 })).toBe(true)
  })
})
