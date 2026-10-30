import { describe, expect, it } from 'vitest'
import { Running } from '../../core/build/run'
import type { BuildTask, Placement, Settings } from '../../core/build/types'
import { FIRST_DESIGN, SCALE_UP, YOUTUBE, youtubeOf } from './build'

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

const FIRST: Placement = { u1: 'queue', t1: 'app', v1: 'cache', o1: 'app', s2: 'database' }

describe('first design', () => {
  it('wins with a queue, a CDN edge and one machine in each lane', () => {
    expect(win(FIRST_DESIGN, FIRST, {})).toBe(true)
  })
  it.each([
    ['no CDN edge', without(FIRST, 'v1')],
    ['no queue', without(FIRST, 'u1')],
    ['a queue behind the transcoder', { ...without(FIRST, 'u1'), t1: 'app', o1: 'queue' } as Placement],
    ['no transcoder', without(FIRST, 't1')],
    ['no origin', without(FIRST, 'o1')],
    ['no shard', without(FIRST, 's2')],
    ['nothing', {} as Placement],
  ])('fails with %s', (_name, placed) => {
    expect(win(FIRST_DESIGN, placed, {})).toBe(false)
  })
})

const GOOD: Placement = { u1: 'queue', u2: 'autoscaler', t1: 'app', t2: 'app', t3: 'app', v1: 'cache', v2: 'cache', o1: 'app', o2: 'app', s1: 'database', s2: 'database', s3: 'database' }
const GOOD_SET: Settings = { rungs: 3, segment: 6, keep: 72, shield: 1 }

describe('where it breaks', () => {
  it.each(Array.from({ length: 40 }, (_, i) => i))('wins with the full design, seed %i', (seed) => {
    expect(win(SCALE_UP, GOOD, GOOD_SET, seed)).toBe(true)
  })
  it('has exactly as many pads as the reference design has pieces', () => {
    expect(SCALE_UP.pads.map((p) => p.id).sort()).toEqual(Object.keys(GOOD).sort())
  })
  it('has no pad left for a piece it does not need', () => {
    const placed = { ...without(GOOD, 's3'), s3: 'ring' } as Placement
    expect(win(SCALE_UP, placed, GOOD_SET)).toBe(false)
    expect(YOUTUBE.review(placed, GOOD_SET).lines.some((l) => !l.ok)).toBe(true)
  })
  it.each([
    ['no queue', without(GOOD, 'u1'), GOOD_SET],
    ['no autoscaler', without(GOOD, 'u2'), GOOD_SET],
    ['one transcoder', without(GOOD, 't2', 't3'), GOOD_SET],
    ['no transcoder', without(GOOD, 't1', 't2', 't3'), GOOD_SET],
    ['no CDN edge', without(GOOD, 'v1', 'v2'), GOOD_SET],
    ['one CDN edge', without(GOOD, 'v2'), GOOD_SET],
    ['no origin', without(GOOD, 'o1', 'o2'), GOOD_SET],
    ['one origin', without(GOOD, 'o2'), GOOD_SET],
    ['no shard', without(GOOD, 's1', 's2', 's3'), GOOD_SET],
    ['one shard', without(GOOD, 's2', 's3'), GOOD_SET],
    ['two shards', without(GOOD, 's3'), GOOD_SET],
    ['one quality', GOOD, { ...GOOD_SET, rungs: 1 }],
    ['two qualities', GOOD, { ...GOOD_SET, rungs: 2 }],
    ['six qualities', GOOD, { ...GOOD_SET, rungs: 6 }],
    ['two-second segments', GOOD, { ...GOOD_SET, segment: 2 }],
    ['twelve-second segments', GOOD, { ...GOOD_SET, segment: 12 }],
    ['edges that keep 8 videos', GOOD, { ...GOOD_SET, keep: 8 }],
    ['edges that keep 8 videos', GOOD, { ...GOOD_SET, keep: 8 }],
    ['no shared cache', GOOD, { ...GOOD_SET, shield: 0 }],
    ['a rate limiter on the uploads', { ...without(GOOD, 's3'), s3: 'limiter' } as Placement, GOOD_SET],
    ['a CDN edge behind the origin', { ...without(GOOD, 'v1'), t2: 'cache', t1: 'app' } as Placement, GOOD_SET],
  ])('fails with %s', (_name, placed, settings) => {
    expect(win(SCALE_UP, placed, settings)).toBe(false)
  })
  it('names the symptom, not the cause', () => {
    const placed = without(GOOD, 'u1')
    const run = new Running(SCALE_UP.assemble(placed, GOOD_SET))
    for (let t = 0; t < 70 * 20; t++) run.step()
    const problem = SCALE_UP.problem?.(run.metrics(), placed, GOOD_SET, run.flow)
    expect(problem).toMatch(/upload|plays|stalled|ready/)
    expect(problem).not.toMatch(/queue|autoscal|CDN|shared cache/i)
    expect(youtubeOf.get(run.flow)).toBeDefined()
  })
})

describe('final review', () => {
  it('marks the reference design all right', () => {
    expect(YOUTUBE.review(GOOD, GOOD_SET).lines.every((l) => l.ok)).toBe(true)
  })
  it('flags a bare design', () => {
    expect(YOUTUBE.review({}, { rungs: 1, segment: 12, keep: 8, shield: 0 }).lines.filter((l) => !l.ok).length).toBe(10)
  })
})
