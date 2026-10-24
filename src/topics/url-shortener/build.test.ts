import { describe, expect, it } from 'vitest'
const mulberry = (a: number) => {
  let t = (a + 0x6d2b79f5) | 0
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}
import { Running } from '../../core/build/run'
import type { BuildTask, Placement, Settings } from '../../core/build/types'
import { FIRST_DESIGN, SCALE_UP, shortenerOf } from './build'

const lcg = (seed: number) => {
  let s = seed * 7919
  return () => mulberry(s++)
}

function win(task: BuildTask, placed: Placement, settings: Settings, seed: number, seconds = 70) {
  const run = new Running(task.assemble(placed, settings, lcg(seed)))
  let held = 0
  for (let t = 0; t < seconds * 20; t++) {
    run.step()
    held = task.check(run.metrics(), placed, settings, run.flow) ? held + 1 : 0
    if (held >= task.holdSeconds * 20) return true
  }
  return false
}
const always = (t: BuildTask, p: Placement, s: Settings) => [1, 2, 3, 4, 5].every((n) => win(t, p, s, n))
const never = (t: BuildTask, p: Placement, s: Settings) => [1, 2, 3, 4, 5].every((n) => !win(t, p, s, n))

const GOOD: Placement = { lb: 'balancer', 'app-1': 'app', 'app-2': 'app', cache: 'cache', queue: 'queue', 'rep-0': 'replica', gate: 'limiter' }
const GOOD_SET: Settings = { scheme: 1, cache: 4, scope: 1, limit: 1 }

describe('first design', () => {
  const placed: Placement = { lb: 'balancer', 'app-1': 'app' }
  it('wins with key ranges or hashes on two servers', () => {
    expect(always(FIRST_DESIGN, placed, { scheme: 1 })).toBe(true)
    expect(always(FIRST_DESIGN, placed, { scheme: 2 })).toBe(true)
  })
  it('fails with a shared counter', () => {
    expect(never(FIRST_DESIGN, placed, { scheme: 0 })).toBe(true)
  })
  it('fails on one server or without a balancer', () => {
    expect(never(FIRST_DESIGN, { lb: 'balancer' }, { scheme: 1 })).toBe(true)
    expect(never(FIRST_DESIGN, { 'app-1': 'app' }, { scheme: 1 })).toBe(true)
  })
})

describe('where it breaks', () => {
  it('wins with the full design', () => {
    expect(always(SCALE_UP, GOOD, GOOD_SET)).toBe(true)
  })
  it('a global limiter turns visitors away', () => {
    expect(never(SCALE_UP, GOOD, { ...GOOD_SET, scope: 0 })).toBe(true)
  })
  it('a shared counter repeats codes', () => {
    expect(never(SCALE_UP, GOOD, { ...GOOD_SET, scheme: 0 })).toBe(true)
  })
  it.each([
    ['no cache', 'cache'],
    ['no balancer', 'lb'],
    ['no queue', 'queue'],
    ['no limiter', 'gate'],
  ])('fails with %s', (_n, key) => {
    const placed = { ...GOOD }
    delete placed[key]
    expect(never(SCALE_UP, placed, GOOD_SET)).toBe(true)
  })
  it('fails with a tiny cache', () => {
    expect(never(SCALE_UP, GOOD, { ...GOOD_SET, cache: 0 })).toBe(true)
  })
  it('reports a problem for a bad build', () => {
    const run = new Running(SCALE_UP.assemble({}, {}, lcg(1)))
    for (let i = 0; i < 20 * 20; i++) run.step()
    expect(shortenerOf.get(run.flow)).toBeDefined()
    expect(SCALE_UP.problem?.(run.metrics(), {}, {}, run.flow)).toBeTruthy()
  })
})
