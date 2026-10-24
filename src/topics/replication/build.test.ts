import { describe, expect, it } from 'vitest'
import { Running, TICKS_PER_SECOND } from '../../core/build/run'
import type { Placement, Settings } from '../../core/build/types'
import { PAYDAY_CRASH as task } from './build'

// A small, well-mixed generator; the usual multiplicative one correlates
// neighbouring draws, which would make reads and writes bunch up.
const mulberry = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

function wins(placed: Placement, settings: Settings, seed: number) {
  const run = new Running(task.assemble(placed, settings, mulberry(seed)))
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

const build = (copies: number): Placement => {
  const placed: Placement = { primary: 'database' }
  for (let i = 0; i < copies; i++) placed[`copy-${i}`] = 'replica'
  return placed
}

describe('payday crash build', () => {
  it('a lone primary never recovers', () => {
    expect(never(build(0), { confirm: 0 })).toBe(true)
    expect(never({}, { confirm: 0 })).toBe(true)
  })

  it('too few copies can’t carry the reads once the primary is gone', () => {
    expect(never(build(2), { confirm: 1 })).toBe(true)
    expect(never(build(3), { confirm: 1 })).toBe(true)
  })

  it('without a confirming replica, recent payments are lost', () => {
    expect(never(build(4), { confirm: 0 })).toBe(true)
    expect(never(build(5), { confirm: 0 })).toBe(true)
  })

  it('too many confirming replicas drown the primary', () => {
    expect(never(build(4), { confirm: 2 })).toBe(true)
    expect(never(build(5), { confirm: 3 })).toBe(true)
  })

  it('enough copies and one confirming replica survives', () => {
    expect(always(build(4), { confirm: 1 })).toBe(true)
    expect(always(build(5), { confirm: 1 })).toBe(true)
  })
})
