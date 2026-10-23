import { describe, expect, it } from 'vitest'
import { Running, TICKS_PER_SECOND } from '../../core/build/run'
import type { Placement, Settings } from '../../core/build/types'
import { CRASH_DRILL as task } from './build'

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

const servers = (n: number, front?: 'ring' | 'balancer'): Placement => {
  const placed: Placement = front ? { front } : {}
  for (let i = 0; i < n; i++) placed[`server-${i}`] = 'server'
  return placed
}

describe('crash drill build', () => {
  it('without a front piece, the database drowns', () => {
    expect(never(servers(5), {})).toBe(true)
    expect(never({}, {})).toBe(true)
  })

  it('a load balancer reshuffles everything when a server dies', () => {
    expect(never(servers(5, 'balancer'), {})).toBe(true)
    expect(never(servers(4, 'balancer'), {})).toBe(true)
  })

  it('a ring with one spot per server swamps a neighbour', () => {
    expect(never(servers(5, 'ring'), { points: 1 })).toBe(true)
  })

  it('too few servers can’t carry the load once one is gone', () => {
    expect(never(servers(3, 'ring'), { points: 8 })).toBe(true)
  })

  it('a ring, five servers and enough spots survives', () => {
    expect(always(servers(5, 'ring'), { points: 8 })).toBe(true)
    expect(always(servers(5, 'ring'), { points: 12 })).toBe(true)
  })
})
