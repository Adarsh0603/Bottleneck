import { describe, expect, it } from 'vitest'
import { Running, TICKS_PER_SECOND } from '../../core/build/run'
import type { Placement, Settings } from '../../core/build/types'
import { BLACK_FRIDAY as task } from './build'

// Runs a build for up to a minute and reports whether the goal would be
// reached, exactly as the builder checks it.
function wins(placed: Placement, settings: Settings, seed: number) {
  let x = seed
  const run = new Running(task.assemble(placed, settings, () => (x = (x * 16807) % 2147483647) / 2147483647))
  let streak = 0
  for (let t = 0; t < TICKS_PER_SECOND * 60; t++) {
    run.step()
    streak = task.check(run.metrics(), placed, settings, run.flow) ? streak + 1 : 0
    if (streak >= task.holdSeconds * TICKS_PER_SECOND) return true
  }
  return false
}

const seeds = [1, 2, 3, 4, 5]
const always = (p: Placement, s: Settings) => seeds.every((seed) => wins(p, s, seed))
const never = (p: Placement, s: Settings) => seeds.every((seed) => !wins(p, s, seed))
// Servers on the back pads, leaving out the pads in `skip`.
const servers = (skip: number[] = []): Placement =>
  Object.fromEntries([0, 1, 2, 3, 4].filter((i) => !skip.includes(i)).map((i) => [`back-${i}`, 'server']))
const balancer: Placement = { front: 'balancer' }

describe('Black Friday build', () => {
  it('nothing built: everything is dropped', () => {
    expect(never({}, {})).toBe(true)
  })

  it('a lone server in front is not enough', () => {
    expect(never({ front: 'server' }, {})).toBe(true)
  })

  it('servers behind a server do nothing: users only reach the front one', () => {
    expect(never({ front: 'server', ...servers() }, {})).toBe(true)
  })

  it('four new servers cannot survive the crash without the old one', () => {
    expect(never({ ...balancer, ...servers([2]) }, { algo: 2 })).toBe(true)
  })

  it('round robin and random drown the old machine', () => {
    expect(never({ ...balancer, ...servers() }, { algo: 0 })).toBe(true)
    expect(never({ ...balancer, ...servers() }, { algo: 1 })).toBe(true)
  })

  it('every server and least connections gets through the crash', () => {
    expect(always({ ...balancer, ...servers() }, { algo: 2 })).toBe(true)
  })
})
