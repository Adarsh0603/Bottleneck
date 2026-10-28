import { describe, expect, it } from 'vitest'
import { Running } from '../../core/build/run'
import type { BuildTask, Placement, Settings } from '../../core/build/types'
import { FIRST_DESIGN, SCALE_UP, TWITTER_TIMELINE, timelineOf } from './build'

const without = (placed: Placement, ...ids: string[]) => Object.fromEntries(Object.entries(placed).filter(([id]) => !ids.includes(id))) as Placement

const rngOf = (seed: number) => () => {
  let t = (seed += 0x6d2b79f5)
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

function win(task: BuildTask, placed: Placement, settings: Settings, seed = 0, seconds = 72) {
  const run = new Running(task.assemble(placed, settings, seed ? rngOf(seed) : undefined))
  let held = 0
  for (let t = 0; t < seconds * 20; t++) {
    run.step()
    // The game stops a run the moment any requirement breaks.
    if (task.requirements?.some((r) => !r.read(run.flow, run.metrics()).ok)) return false
    held = task.check(run.metrics(), placed, settings, run.flow) ? held + 1 : 0
    if (held >= task.holdSeconds * 20) return true
  }
  return false
}

const FIRST: Placement = { a0: 'queue', w1: 'app', r1: 'app', s2: 'database' }

describe('first design', () => {
  it('wins when tweets are written into timelines when they are sent', () => {
    expect(win(FIRST_DESIGN, FIRST, { when: 0 })).toBe(true)
    expect(win(FIRST_DESIGN, { ...FIRST, a1: 'cache' }, { when: 0 })).toBe(true)
    expect(win(FIRST_DESIGN, without(FIRST, 'a0'), { when: 0 })).toBe(true)
  })
  it.each([
    ['looking everything up when opened', FIRST, { when: 1 }],
    ['looking up, with a cache', { ...FIRST, a1: 'cache' } as Placement, { when: 1 }],
    ['a queue behind the workers', { ...without(FIRST, 'a0'), w2: 'queue' } as Placement, { when: 0 }],
    ['no timeline server', without(FIRST, 'r1'), { when: 0 }],
    ['no worker', without(FIRST, 'w1'), { when: 0 }],
    ['no shard', without(FIRST, 's2'), { when: 0 }],
  ])('fails with %s', (_name, placed, settings) => {
    expect(win(FIRST_DESIGN, placed, settings)).toBe(false)
  })
})

const GOOD: Placement = { a0: 'queue', a1: 'cache', a2: 'cache', r1: 'app', w1: 'app', w2: 'app', w3: 'app', s1: 'database', s2: 'database', s3: 'database', s4: 'database' }
const GOOD_SET: Settings = { line: 1000, length: 800, holds: 1, rebuild: 1 }

describe('where it breaks', () => {
  it.each(Array.from({ length: 25 }, (_, i) => i))('wins with the full design, seed %i', (seed) => {
    expect(win(SCALE_UP, GOOD, GOOD_SET, seed)).toBe(true)
  })
  it('has exactly as many pads as the reference design has pieces', () => {
    expect(SCALE_UP.pads.length).toBe(Object.keys(GOOD).length)
    expect(SCALE_UP.pads.map((p) => p.id).sort()).toEqual(Object.keys(GOOD).sort())
  })
  it('has no pad left for a piece it does not need', () => {
    const placed = { ...without(GOOD, 'w3'), w3: 'ring' } as Placement
    expect(win(SCALE_UP, placed, GOOD_SET)).toBe(false)
    expect(TWITTER_TIMELINE.review(placed, GOOD_SET).lines.some((l) => !l.ok)).toBe(true)
  })
  it.each([
    ['copying every tweet', GOOD, { ...GOOD_SET, line: 5000 }],
    ['looking up mid accounts too', GOOD, { ...GOOD_SET, line: 50 }],
    ['looking everything up', GOOD, { ...GOOD_SET, line: 10 }],
    ['timelines too short to scroll', GOOD, { ...GOOD_SET, length: 200 }],
    ['full copies in the timelines, which a delete must rewrite', GOOD, { ...GOOD_SET, holds: 0 }],
    ['every open rebuilding its own timeline', GOOD, { ...GOOD_SET, rebuild: 0 }],
    ['one cache, which a restart empties', without(GOOD, 'a2'), GOOD_SET],
    ['no cache', without(GOOD, 'a1', 'a2'), GOOD_SET],
    ['no queue', without(GOOD, 'a0'), GOOD_SET],
    ['no timeline server', without(GOOD, 'r1'), GOOD_SET],
    ['no worker', without(GOOD, 'w1', 'w2', 'w3'), GOOD_SET],
    ['one worker', without(GOOD, 'w2', 'w3'), GOOD_SET],
    ['two workers', without(GOOD, 'w3'), GOOD_SET],
    ['no shard', without(GOOD, 's1', 's2', 's3', 's4'), GOOD_SET],
    ['one shard', without(GOOD, 's2', 's3', 's4'), GOOD_SET],
    ['two shards', without(GOOD, 's3', 's4'), GOOD_SET],
    ['the cache behind the timeline server', { ...without(GOOD, 'a2', 'w2'), w2: 'cache' } as Placement, GOOD_SET],
  ])('fails with %s', (_name, placed, settings) => {
    for (const seed of [0, 3, 6]) expect(win(SCALE_UP, placed, settings, seed)).toBe(false)
  })
  // A design with no margin may survive one day and not the next.
  const days = (placed: Placement, settings: Settings) => Array.from({ length: 40 }, (_, i) => win(SCALE_UP, placed, settings, i + 1)).filter(Boolean).length
  it('fails some days with only the shards the peak needs, and with timelines that rebuild slowly', () => {
    expect(days(without(GOOD, 's4'), GOOD_SET)).toBeLessThan(40)
    expect(days(GOOD, { ...GOOD_SET, length: 2000 })).toBeLessThan(10)
  })
  it('names the symptom, not the cause', () => {
    const settings = { ...GOOD_SET, rebuild: 0, length: 1200 }
    const run = new Running(SCALE_UP.assemble(GOOD, settings))
    for (let t = 0; t < 72 * 20 && SCALE_UP.requirements!.every((r) => r.read(run.flow, run.metrics()).ok); t++) run.step()
    const problem = SCALE_UP.problem?.(run.metrics(), GOOD, settings, run.flow)
    expect(problem).toMatch(/given up on|lost|took|Opening|stayed|still showing/)
    expect(problem).not.toMatch(/rebuild|collapse/i)
    expect(timelineOf.get(run.flow)).toBeDefined()
  })
  it('says which lane has no machine', () => {
    const placed = without(GOOD, 'r1')
    const run = new Running(SCALE_UP.assemble(placed, GOOD_SET))
    for (let t = 0; t < 40; t++) run.step()
    expect(SCALE_UP.problem?.(run.metrics(), placed, GOOD_SET, run.flow)).toMatch(/readers’ side/)
  })
  it('says why a cache is in the wrong place', () => {
    const placed = { ...without(GOOD, 'a1', 'a2', 'w2'), w2: 'cache' } as Placement
    const run = new Running(SCALE_UP.assemble(placed, GOOD_SET))
    for (let t = 0; t < 200; t++) run.step()
    expect(SCALE_UP.problem?.(run.metrics(), placed, GOOD_SET, run.flow)).toMatch(/cache/)
  })
})

describe('a changing day', () => {
  it('gives every run its own day, a little busier or later', () => {
    expect(SCALE_UP.freshDay).toBe(true)
    const cfgs = [1, 2, 3, 4].map((seed) => timelineOf.get(SCALE_UP.assemble(GOOD, GOOD_SET, rngOf(seed)))!.cfg)
    expect(new Set(cfgs.map((c) => c.stars[0])).size).toBeGreaterThan(1)
    expect(new Set(cfgs.map((c) => c.phases[3].opens)).size).toBeGreaterThan(1)
    for (const c of cfgs) {
      expect(c.phases[3].opens).toBeGreaterThanOrEqual(66)
      expect(c.phases[3].opens).toBeLessThanOrEqual(66 * 1.2)
      expect(c.stars[0]).toBeGreaterThanOrEqual(30 * 20)
      expect(c.stars[0]).toBeLessThan(40 * 20) // still inside its own part of the day
      expect(c.coldAt).toBeLessThan(46 * 20)
    }
  })
  it('keeps the same day for the same seed', () => {
    const a = timelineOf.get(SCALE_UP.assemble(GOOD, GOOD_SET, rngOf(9)))!.cfg
    const b = timelineOf.get(SCALE_UP.assemble(GOOD, GOOD_SET, rngOf(9)))!.cfg
    expect(a.phases).toEqual(b.phases)
    expect(a.coldAt).toBe(b.coldAt)
  })
})

describe('the hint after repeated failures', () => {
  const hint = (placed: Placement, settings: Settings) => {
    const run = new Running(SCALE_UP.assemble(placed, settings))
    return SCALE_UP.hint?.(run.metrics(), placed, settings, run.flow)
  }
  it.each([
    ['celebrity written', GOOD, { ...GOOD_SET, line: 5000 }, /celebrity/],
    ['mid accounts looked up', GOOD, { ...GOOD_SET, line: 50 }, /bigger accounts/],
    ['full copies', GOOD, { ...GOOD_SET, holds: 0 }, /only the id/],
    ['too short', GOOD, { ...GOOD_SET, length: 200 }, /scrolls/],
    ['too long', GOOD, { ...GOOD_SET, length: 2000 }, /rebuild/],
    ['no queue', without(GOOD, 'a0'), GOOD_SET, /hold them/],
    ['two workers', without(GOOD, 'w3'), GOOD_SET, /at least 3/],
    ['one cache', without(GOOD, 'a2'), GOOD_SET, /cache/],
    ['three shards', without(GOOD, 's4'), GOOD_SET, /shard answers 120/],
    ['every open rebuilds', GOOD, { ...GOOD_SET, rebuild: 0 }, /one open rebuild/i],
  ])('names the cause: %s', (_name, placed, settings, says) => {
    expect(hint(placed as Placement, settings as Settings)).toMatch(says)
  })
  it('has nothing to add for the reference design', () => {
    expect(hint(GOOD, GOOD_SET)).toBeNull()
  })
})

describe('the win card', () => {
  it('reports what the run achieved, not the pieces', () => {
    const run = new Running(SCALE_UP.assemble(GOOD, GOOD_SET))
    for (let t = 0; t < 68 * 20; t++) run.step()
    const text = SCALE_UP.result?.(run.metrics(), GOOD, GOOD_SET, run.flow) ?? ''
    expect(text).toMatch(/timelines opened/)
    expect(text).toMatch(/celebrity/)
    expect(text).not.toMatch(/pads|shard|worker/i)
    const first = new Running(FIRST_DESIGN.assemble(FIRST, { when: 0 }))
    for (let t = 0; t < 32 * 20; t++) first.step()
    expect(FIRST_DESIGN.result?.(first.metrics(), FIRST, { when: 0 }, first.flow)).toMatch(/timelines opened/)
  })
})

describe('final review', () => {
  it('marks the reference design all right', () => {
    expect(TWITTER_TIMELINE.review(GOOD, GOOD_SET).lines.every((l) => l.ok)).toBe(true)
  })
  it('reads a build saved on an older board without crashing', () => {
    const old = { ...GOOD, a3: 'cache', w4: 'app', r2: 'app', r4: 'limiter', s5: 'database', d0: 'ring' } as Placement
    const review = TWITTER_TIMELINE.review(old, { cutoff: 1, holds: 1, rebuild: 1 })
    expect(review.lines.length).toBeGreaterThan(0)
    expect(review.lines.find((l) => l.label === 'Workers')?.ok).toBe(true)
  })
  it('flags a bare design', () => {
    expect(TWITTER_TIMELINE.review({}, { line: 5000 }).lines.filter((l) => !l.ok).length).toBe(9)
  })
})
