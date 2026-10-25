import { describe, expect, it } from 'vitest'
const mulberry = (a: number) => {
  let t = (a + 0x6d2b79f5) | 0
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}
import { Running } from '../../core/build/run'
import type { BuildTask, Placement, Settings } from '../../core/build/types'
import { canDrop } from '../../core/build/placement'
import { FIRST_DESIGN, INTRO, SCALE_UP, URL_SHORTENER, shortenerOf } from './build'

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

describe('any spot', () => {
  it('allows any piece on any pad', () => {
    expect(canDrop(SCALE_UP, {}, 'spare-0', 'cache')).toBe(true)
    expect(canDrop(SCALE_UP, {}, 'gate', 'replica')).toBe(true)
  })
  it('wins with the right pieces on other spots, in the right order', () => {
    expect(always(SCALE_UP, { ...GOOD, 'rep-0': 'replica', 'rep-1': 'replica' }, GOOD_SET)).toBe(true)
  })
  it('jams when a part stands in front of one it needs', () => {
    const placed: Placement = { ...GOOD, gate: 'cache', 'spare-0': 'limiter' }
    delete placed.cache
    expect(never(SCALE_UP, placed, GOOD_SET)).toBe(true)
    const run = new Running(SCALE_UP.assemble(placed, GOOD_SET, lcg(1)))
    for (let i = 0; i < 5 * 20; i++) run.step()
    expect(SCALE_UP.problem?.(run.metrics(), placed, GOOD_SET, run.flow)).toMatch(/in front of/)
  })
  it('a piece that does nothing is called out but does not break the design', () => {
    const placed = { ...GOOD, 'spare-0': 'dedupe' as const }
    expect(always(SCALE_UP, placed, GOOD_SET)).toBe(true)
    const line = URL_SHORTENER.review(placed, GOOD_SET).lines.find((l) => l.label === 'Extras')
    expect(line?.ok).toBe(false)
  })
})

describe('the winning design', () => {
  it('never breaks a requirement on the way, so the run is not stopped early', () => {
    for (const seed of [1, 2, 3]) {
      const run = new Running(SCALE_UP.assemble(GOOD, GOOD_SET, lcg(seed)))
      for (let t = 0; t < 60 * 20; t++) {
        run.step()
        const bad = SCALE_UP.requirements!.filter((r) => !r.read(run.flow, run.metrics()).ok)
        expect(bad.map((r) => r.label), `seed ${seed} tick ${t}`).toEqual([])
      }
    }
  })
})

describe('intro', () => {
  it('runs a small board and every step points at a piece that exists', () => {
    const run = new Running(INTRO.task.assemble({}, {}, lcg(1)))
    for (let i = 0; i < 30 * 20; i++) run.step()
    const ids = INTRO.task.fixed!.map((f) => f.id)
    for (const step of INTRO.steps) if (step.at) expect(ids).toContain(step.at)
    for (const q of URL_SHORTENER.estimate.questions) expect(ids).toContain(q.at)
  })
})
