import { describe, expect, it } from 'vitest'
import { Running } from '../../core/build/run'
import type { BuildTask, Placement, Settings } from '../../core/build/types'
import { FIRST_DESIGN, NEWS_FEED, SCALE_UP, feedOf } from './build'

function win(task: BuildTask, placed: Placement, settings: Settings, seconds = 70) {
  const run = new Running(task.assemble(placed, settings))
  let held = 0
  for (let t = 0; t < seconds * 20; t++) {
    run.step()
    held = task.check(run.metrics(), placed, settings, run.flow) ? held + 1 : 0
    if (held >= task.holdSeconds * 20) return true
  }
  return false
}

const FIRST: Placement = { a0: 'queue' }

describe('first design', () => {
  it('wins when posts are copied when they are made', () => {
    expect(win(FIRST_DESIGN, FIRST, { when: 0 })).toBe(true)
    expect(win(FIRST_DESIGN, { ...FIRST, a1: 'cache' }, { when: 0 })).toBe(true)
    expect(win(FIRST_DESIGN, {}, { when: 0 })).toBe(true)
  })
  it.each([
    ['looking everything up when opened', FIRST, { when: 1 }],
    ['looking up, with a cache', { ...FIRST, a1: 'cache' } as Placement, { when: 1 }],
    ['a queue behind the workers', { w1: 'queue' } as Placement, { when: 0 }],
  ])('fails with %s', (_name, placed, settings) => {
    expect(win(FIRST_DESIGN, placed, settings)).toBe(false)
  })
})

const GOOD: Placement = { a0: 'queue', a1: 'cache', w1: 'app', w2: 'app', s1: 'database', s2: 'database' }
const GOOD_SET: Settings = { cutoff: 1, idle: 0 }
const without = (placed: Placement, ...ids: string[]) => Object.fromEntries(Object.entries(placed).filter(([id]) => !ids.includes(id))) as Placement

describe('where it breaks', () => {
  it('wins with the full design', () => {
    expect(win(SCALE_UP, GOOD, GOOD_SET)).toBe(true)
  })
  it('still wins with pieces it does not need, but they are flagged', () => {
    const placed = { ...GOOD, d0: 'ring', d1: 'breaker' } as Placement
    expect(win(SCALE_UP, placed, GOOD_SET)).toBe(true)
    expect(NEWS_FEED.review(placed, GOOD_SET).lines.some((l) => !l.ok)).toBe(true)
  })
  it.each([
    ['copying every post', GOOD, { ...GOOD_SET, cutoff: 0 }],
    ['looking up mid accounts too', GOOD, { ...GOOD_SET, cutoff: 2 }],
    ['looking everything up', GOOD, { ...GOOD_SET, cutoff: 3 }],
    ['no queue', without(GOOD, 'a0'), GOOD_SET],
    ['no cache', without(GOOD, 'a1'), GOOD_SET],
    ['one worker', without(GOOD, 'w1', 'w2'), GOOD_SET],
    ['a single extra shard', without(GOOD, 's2'), GOOD_SET],
    ['skipping idle followers, whose opens rebuild the feed', GOOD, { ...GOOD_SET, idle: 1 }],
    ['a rate limiter in front of the readers', { ...GOOD, d1: 'limiter' } as Placement, GOOD_SET],
    ['a rate limiter in front of the writers', { ...GOOD, d0: 'limiter' } as Placement, GOOD_SET],
    ['the cache behind the feed server', { ...without(GOOD, 'a1'), d1: 'cache' } as Placement, GOOD_SET],
  ])('fails with %s', (_name, placed, settings) => {
    expect(win(SCALE_UP, placed, settings)).toBe(false)
  })
  it('names the symptom, not the cause', () => {
    const placed = without(GOOD, 'a1')
    const run = new Running(SCALE_UP.assemble(placed, GOOD_SET))
    for (let t = 0; t < 70 * 20; t++) run.step()
    const problem = SCALE_UP.problem?.(run.metrics(), placed, GOOD_SET, run.flow)
    expect(problem).toMatch(/turned away|lost|took|Opening/)
    expect(problem).not.toMatch(/cache/i)
    expect(feedOf.get(run.flow)).toBeDefined()
  })
  it('says why a cache is in the wrong place', () => {
    const placed = { ...without(GOOD, 'a1'), d1: 'cache' } as Placement
    const run = new Running(SCALE_UP.assemble(placed, GOOD_SET))
    for (let t = 0; t < 200; t++) run.step()
    expect(SCALE_UP.problem?.(run.metrics(), placed, GOOD_SET, run.flow)).toMatch(/cache/)
  })
})

describe('final review', () => {
  it('marks the reference design all right', () => {
    expect(NEWS_FEED.review(GOOD, GOOD_SET).lines.every((l) => l.ok)).toBe(true)
  })
  it('flags a bare design', () => {
    expect(NEWS_FEED.review({}, { cutoff: 0 }).lines.filter((l) => !l.ok).length).toBe(5)
  })
})
