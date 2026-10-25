import { describe, expect, it } from 'vitest'
import { Running } from '../../core/build/run'
import type { BuildTask, Placement, Settings } from '../../core/build/types'
import { canDrop } from '../../core/build/placement'
import { FIRST_DESIGN, INTRO, SCALE_UP, WEB_CRAWLER, crawlerOf } from './build'

function win(task: BuildTask, placed: Placement, settings: Settings, seconds = 75) {
  const run = new Running(task.assemble(placed, settings))
  let held = 0
  for (let t = 0; t < seconds * 20; t++) {
    run.step()
    held = task.check(run.metrics(), placed, settings, run.flow) ? held + 1 : 0
    if (held >= task.holdSeconds * 20) return true
  }
  return false
}

const FIRST: Placement = { l0: 'dedupe', l1: 'queue', t0: 'limiter' }
const FIRST_SET: Settings = { bits: 3, delay: 2, robots: 1 }

describe('first design', () => {
  it('wins with a seen-set, a frontier, a timer and robots.txt', () => {
    expect(win(FIRST_DESIGN, FIRST, FIRST_SET)).toBe(true)
    expect(win(FIRST_DESIGN, FIRST, { ...FIRST_SET, delay: 3 })).toBe(true)
  })
  it.each([
    ['no seen-set', { l1: 'queue', t0: 'limiter' } as Placement, FIRST_SET],
    ['no frontier', { l0: 'dedupe', t0: 'limiter' } as Placement, FIRST_SET],
    ['no timer', { l0: 'dedupe', l1: 'queue' } as Placement, FIRST_SET],
    ['a wait that is too short', FIRST, { ...FIRST_SET, delay: 1 }],
    ['a seen-set with 2 switches per page', FIRST, { ...FIRST_SET, bits: 0 }],
    ['a seen-set with 4 switches per page', FIRST, { ...FIRST_SET, bits: 1 }],
    ['ignoring robots.txt', FIRST, { ...FIRST_SET, robots: 0 }],
    ['the frontier in front of the seen-set', { l0: 'queue', l1: 'dedupe', t0: 'limiter' } as Placement, FIRST_SET],
    ['the seen-set level with the frontier', { l1: 'dedupe', t1: 'queue', t0: 'limiter' } as Placement, FIRST_SET],
  ])('fails with %s', (_name, placed, settings) => {
    expect(win(FIRST_DESIGN, placed, settings)).toBe(false)
  })
})

const GOOD: Placement = { l0: 'dedupe', l1: 'queue', l2: 'ring', t0: 'limiter', f1: 'app', f2: 'app' }
const GOOD_SET: Settings = { bits: 3, budget: 2, keep: 1, delay: 2, robots: 1 }

describe('where it breaks', () => {
  it('wins with the full design', () => {
    expect(win(SCALE_UP, GOOD, GOOD_SET)).toBe(true)
  })
  it('also wins with a 1 second wait and a cap of 40', () => {
    expect(win(SCALE_UP, GOOD, { ...GOOD_SET, delay: 3, budget: 1 })).toBe(true)
  })
  it.each([
    ['no hash ring', { ...GOOD, l2: undefined } as unknown as Placement, GOOD_SET],
    ['no cap on pages per site', GOOD, { ...GOOD_SET, budget: 4 }],
    ['a cap of 80', GOOD, { ...GOOD_SET, budget: 3 }],
    ['a cap of 20', GOOD, { ...GOOD_SET, budget: 0 }],
    ['forgetting handed-out addresses', GOOD, { ...GOOD_SET, keep: 0 }],
    ['one fetcher', { ...GOOD, f1: undefined, f2: undefined } as unknown as Placement, GOOD_SET],
    ['two fetchers', { ...GOOD, f2: undefined } as unknown as Placement, GOOD_SET],
    ['no seen-set', { ...GOOD, l0: undefined } as unknown as Placement, GOOD_SET],
    ['no frontier', { ...GOOD, l1: undefined } as unknown as Placement, GOOD_SET],
    ['no timer', { ...GOOD, t0: undefined } as unknown as Placement, GOOD_SET],
    ['a wait that is too short', GOOD, { ...GOOD_SET, delay: 1 }],
    ['a wait of 2 seconds', GOOD, { ...GOOD_SET, delay: 4 }],
    ['a seen-set with 4 switches per page', GOOD, { ...GOOD_SET, bits: 1 }],
    ['ignoring robots.txt', GOOD, { ...GOOD_SET, robots: 0 }],
    ['a cache', { ...GOOD, b0: 'cache' } as Placement, GOOD_SET],
    ['the ring in front of the frontier', { ...GOOD, l1: 'ring', l2: 'queue' } as Placement, GOOD_SET],
    ['a seen-set among the fetchers', { ...GOOD, l0: undefined, f1: 'dedupe', b1: 'app' } as unknown as Placement, GOOD_SET],
  ])('fails with %s', (_name, placed, settings) => {
    expect(win(SCALE_UP, placed, settings)).toBe(false)
  })
})

describe('the crawl itself', () => {
  it('is the same every time', () => {
    const run = () => {
      const r = new Running(SCALE_UP.assemble(GOOD, GOOD_SET))
      for (let t = 0; t < 40 * 20; t++) r.step()
      return crawlerOf.get(r.flow)!.got()
    }
    expect(run()).toBe(run())
  })
  it('a dead fetcher’s addresses come back only when the frontier kept them', () => {
    const lost = (keep: number) => {
      const r = new Running(SCALE_UP.assemble(GOOD, { ...GOOD_SET, keep }))
      for (let t = 0; t < 45 * 20; t++) r.step()
      return crawlerOf.get(r.flow)!.lost()
    }
    expect(lost(1)).toBeLessThanOrEqual(4)
    expect(lost(0)).toBeGreaterThan(4)
  })
  it('the intro runs a tiny crawl', () => {
    const r = new Running(INTRO.task.assemble({}, {}))
    for (let t = 0; t < 30 * 20; t++) r.step()
    const c = crawlerOf.get(r.flow)!
    expect(c.got()).toBeGreaterThan(10)
    expect(c.banned.size).toBe(0)
  })
})

describe('pads', () => {
  it('any piece fits any spot', () => {
    expect(canDrop(SCALE_UP, {}, 'f1', 'ring')).toBe(true)
    expect(canDrop(SCALE_UP, {}, 'b0', 'app')).toBe(true)
  })
  it('the estimate answers are valid', () => {
    for (const q of WEB_CRAWLER.estimate.questions) expect(q.answer).toBeLessThan(q.options.length)
  })
})
