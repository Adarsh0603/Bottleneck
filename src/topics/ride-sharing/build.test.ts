import { describe, expect, it } from 'vitest'
import { Running } from '../../core/build/run'
import type { BuildTask, Placement, Settings } from '../../core/build/types'
import { FIRST_DESIGN, RIDE_SHARING, SCALE_UP, rideOf } from './build'

function win(task: BuildTask, placed: Placement, settings: Settings, seconds = 90) {
  const run = new Running(task.assemble(placed, settings))
  let held = 0
  for (let t = 0; t < seconds * 20; t++) {
    run.step()
    // The player stops the run the moment any requirement turns red.
    if (task.failFast && task.requirements?.some((r) => !r.read(run.flow, run.metrics()).ok)) return false
    held = task.check(run.metrics(), placed, settings, run.flow) ? held + 1 : 0
    if (held >= task.holdSeconds * 20) return true
  }
  return false
}

describe('first design', () => {
  it('wins with a live map and the pings written into it', () => {
    expect(win(FIRST_DESIGN, { d1: 'cache' }, { pings: 1 })).toBe(true)
    expect(win(FIRST_DESIGN, { d2: 'cache', d1: 'queue' }, { pings: 1 })).toBe(false)
  })
  it.each([
    ['no live map', {} as Placement, { pings: 1 }],
    ['a live map no pings go to', { d1: 'cache' } as Placement, { pings: 0 }],
    ['the live map in front of dispatch', { f1: 'cache' } as Placement, { pings: 1 }],
    ['the live map behind dispatch', { g1: 'cache' } as Placement, { pings: 1 }],
  ])('fails with %s', (_name, placed, settings) => {
    expect(win(FIRST_DESIGN, placed, settings)).toBe(false)
  })
})

const GOOD: Placement = { f1: 'server', f3: 'queue', g1: 'dedupe', d1: 'cache' }
const GOOD_SET: Settings = { pings: 1, shards: 3, split: 1, claim: 1, crash: 1 }
const without = (placed: Placement, ...ids: string[]) => Object.fromEntries(Object.entries(placed).filter(([id]) => !ids.includes(id))) as Placement

describe('where it breaks', () => {
  it('wins with the full design', () => {
    expect(win(SCALE_UP, GOOD, GOOD_SET)).toBe(true)
  })
  it('still wins with four shards, and a piece it does not need is flagged', () => {
    expect(win(SCALE_UP, GOOD, { ...GOOD_SET, shards: 4 })).toBe(true)
    const placed = { ...GOOD, g2: 'breaker' } as Placement
    expect(win(SCALE_UP, placed, GOOD_SET)).toBe(true)
    expect(RIDE_SHARING.review(placed, GOOD_SET).lines.some((l) => !l.ok)).toBe(true)
  })
  it.each([
    ['pings into the database', GOOD, { ...GOOD_SET, pings: 0 }],
    ['no live map', without(GOOD, 'd1'), GOOD_SET],
    ['fixed map cells', GOOD, { ...GOOD_SET, split: 0 }],
    ['no map server', without(GOOD, 'f1'), GOOD_SET],
    ['one shard', GOOD, { ...GOOD_SET, shards: 1 }],
    ['two shards', GOOD, { ...GOOD_SET, shards: 2 }],
    ['offering the nearest car', GOOD, { ...GOOD_SET, claim: 0 }],
    ['no claim store', without(GOOD, 'g1'), GOOD_SET],
    ['requests kept in memory', GOOD, { ...GOOD_SET, crash: 0 }],
    ['no request log', without(GOOD, 'f3'), GOOD_SET],
    ['a rate limiter in front', { ...GOOD, f4: 'limiter' } as Placement, GOOD_SET],
  ])('fails with %s', (_name, placed, settings) => {
    expect(win(SCALE_UP, placed, settings)).toBe(false)
  })
  it('jams when the map server stands behind dispatch', () => {
    const placed: Placement = { ...without(GOOD, 'f1'), g2: 'server' }
    expect(win(SCALE_UP, placed, GOOD_SET)).toBe(false)
    const run = new Running(SCALE_UP.assemble(placed, GOOD_SET))
    for (let t = 0; t < 100; t++) run.step()
    expect(SCALE_UP.problem?.(run.metrics(), placed, GOOD_SET, run.flow)).toMatch(/map server has to stand between/)
  })
  it('says what the crash cost, and not why', () => {
    const settings = { ...GOOD_SET, crash: 0 }
    const run = new Running(SCALE_UP.assemble(GOOD, settings))
    for (let t = 0; t < 60 * 20 && !SCALE_UP.requirements?.some((r) => !r.read(run.flow, run.metrics()).ok); t++) run.step()
    const problem = SCALE_UP.problem?.(run.metrics(), GOOD, settings, run.flow)
    expect(problem).toMatch(/Dispatch crashed with rides being matched\. Some of them were lost/)
    expect(problem).not.toMatch(/log|replay/i)
  })
  it('names the symptom, not the cause', () => {
    const placed = without(GOOD, 'g1')
    const run = new Running(SCALE_UP.assemble(placed, GOOD_SET))
    for (let t = 0; t < 400; t++) run.step()
    const problem = SCALE_UP.problem?.(run.metrics(), placed, GOOD_SET, run.flow)
    expect(problem).toMatch(/already on its way/)
    expect(problem).not.toMatch(/claim/i)
    expect(rideOf.get(run.flow)).toBeDefined()
  })
})

describe('final review', () => {
  it('marks the reference design all right', () => {
    expect(RIDE_SHARING.review(GOOD, GOOD_SET).lines.every((l) => l.ok)).toBe(true)
  })
  it('flags a bare design', () => {
    expect(RIDE_SHARING.review({}, {}).lines.filter((l) => !l.ok).length).toBe(4)
  })
})
