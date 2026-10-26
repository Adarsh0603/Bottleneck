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
  it('wins when posts are copied and a queue holds them', () => {
    expect(win(FIRST_DESIGN, FIRST, { mode: 1 })).toBe(true)
    expect(win(FIRST_DESIGN, { ...FIRST, a1: 'cache' }, { mode: 1 })).toBe(true)
    expect(win(FIRST_DESIGN, FIRST, { mode: 2 })).toBe(true)
  })
  it.each([
    ['looking everything up when opened', FIRST, { mode: 0 }],
    ['looking up, with a cache', { ...FIRST, a1: 'cache' } as Placement, { mode: 0 }],
    ['copying with no queue', {} as Placement, { mode: 1 }],
    ['copying, with only a cache', { a1: 'cache' } as Placement, { mode: 1 }],
    ['a queue behind the workers', { w1: 'queue' } as Placement, { mode: 1 }],
  ])('fails with %s', (_name, placed, settings) => {
    expect(win(FIRST_DESIGN, placed, settings)).toBe(false)
  })
})

const GOOD: Placement = { a0: 'queue', a1: 'cache', w1: 'app', w2: 'app', s1: 'database' }
const GOOD_SET: Settings = { mode: 2, idle: 0 }

describe('where it breaks', () => {
  it('wins with the full design', () => {
    expect(win(SCALE_UP, GOOD, GOOD_SET)).toBe(true)
    expect(win(SCALE_UP, { ...GOOD, s2: 'database' }, GOOD_SET)).toBe(true)
  })
  it.each([
    ['copying for everyone, celebrity too', GOOD, { ...GOOD_SET, mode: 1 }],
    ['looking everything up when opened', GOOD, { ...GOOD_SET, mode: 0 }],
    ['no queue', { ...GOOD, a0: undefined } as unknown as Placement, GOOD_SET],
    ['no cache', { ...GOOD, a1: undefined } as unknown as Placement, GOOD_SET],
    ['one worker', { ...GOOD, w1: undefined, w2: undefined } as unknown as Placement, GOOD_SET],
    ['skipping idle followers, whose opens rebuild the feed', GOOD, { ...GOOD_SET, idle: 1 }],
    ['a single store shard', { ...GOOD, s1: undefined } as unknown as Placement, GOOD_SET],
    ['the cache behind the feed server', { ...GOOD, a1: undefined, s2: 'cache' } as unknown as Placement, GOOD_SET],
  ])('fails with %s', (_name, placed, settings) => {
    expect(win(SCALE_UP, placed, settings)).toBe(false)
  })
  it('says why the cache is in the wrong place', () => {
    const run = new Running(SCALE_UP.assemble({ ...GOOD, a1: undefined, s2: 'cache' } as unknown as Placement, GOOD_SET))
    for (let t = 0; t < 200; t++) run.step()
    const problem = SCALE_UP.problem?.(run.metrics(), { ...GOOD, a1: undefined, s2: 'cache' } as unknown as Placement, GOOD_SET, run.flow)
    expect(problem).toMatch(/cache/)
    expect(feedOf.get(run.flow)).toBeDefined()
  })
})

describe('final review', () => {
  it('marks the reference design all right', () => {
    expect(NEWS_FEED.review({ ...GOOD, s2: 'database' }, GOOD_SET).lines.every((l) => l.ok)).toBe(true)
  })
  it('flags a bare design', () => {
    expect(NEWS_FEED.review({}, { mode: 0 }).lines.filter((l) => !l.ok).length).toBe(5)
  })
})
