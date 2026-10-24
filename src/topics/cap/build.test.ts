import { describe, expect, it } from 'vitest'
import { Running, TICKS_PER_SECOND } from '../../core/build/run'
import type { Settings } from '../../core/build/types'
import { PARTITION_CALL as task } from './build'

const mulberry = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

function wins(settings: Settings, seed: number) {
  const run = new Running(task.assemble({}, settings, mulberry(seed)))
  let streak = 0
  for (let t = 0; t < TICKS_PER_SECOND * 60; t++) {
    run.step()
    streak = task.check(run.metrics(), {}, settings, run.flow) ? streak + 1 : 0
    if (streak >= task.holdSeconds * TICKS_PER_SECOND) return true
  }
  return false
}

const seeds = [1, 2, 3, 4, 5]
const always = (s: Settings) => seeds.every((seed) => wins(s, seed))
const never = (s: Settings) => seeds.every((seed) => !wins(s, seed))

// 0 = refuse, 1 = answer
describe('partition build', () => {
  it('wins when the bank refuses and the feed answers', () => {
    expect(always({ bank: 0, feed: 1 })).toBe(true)
  })
  it('never wins when the bank answers', () => {
    expect(never({ bank: 1, feed: 1 })).toBe(true)
  })
  it('never wins when the feed refuses', () => {
    expect(never({ bank: 0, feed: 0 })).toBe(true)
  })
  it('never wins with the choices swapped', () => {
    expect(never({ bank: 1, feed: 0 })).toBe(true)
  })
})
