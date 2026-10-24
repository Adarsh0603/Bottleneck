import { describe, expect, it } from 'vitest'
import { Running, TICKS_PER_SECOND } from '../../core/build/run'
import type { Placement } from '../../core/build/types'
import { FLASH_SALE as task } from './build'

const mulberry = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

function wins(placed: Placement, seed: number) {
  const run = new Running(task.assemble(placed, {}, mulberry(seed)))
  let streak = 0
  for (let t = 0; t < TICKS_PER_SECOND * 70; t++) {
    run.step()
    streak = task.check(run.metrics(), placed, {}, run.flow) ? streak + 1 : 0
    if (streak >= task.holdSeconds * TICKS_PER_SECOND) return true
  }
  return false
}

const seeds = [1, 2, 3, 4, 5]
const always = (p: Placement) => seeds.every((seed) => wins(p, seed))
const never = (p: Placement) => seeds.every((seed) => !wins(p, seed))

const build = (workers: number, queue = true): Placement => {
  const placed: Placement = {}
  if (queue) placed.queue = 'queue'
  for (let i = 0; i < workers; i++) placed[`worker-${i}`] = 'server'
  return placed
}

describe('flash sale build', () => {
  it('wins with a queue and 5 or 6 workers', () => {
    expect(always(build(5))).toBe(true)
    expect(always(build(6))).toBe(true)
  })

  it('never wins with a queue and 4 or fewer workers: it overflows', () => {
    for (const n of [1, 2, 3, 4]) expect(never(build(n))).toBe(true)
  })

  it('never wins without a queue, however many workers', () => {
    for (const n of [0, 3, 6]) expect(never(build(n, false))).toBe(true)
  })

  it('never wins with a queue and no workers', () => {
    expect(never(build(0))).toBe(true)
  })
})
