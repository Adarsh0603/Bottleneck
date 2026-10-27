import { describe, expect, it } from 'vitest'
import { Running } from '../../core/build/run'
import type { BuildTask, Placement, Settings } from '../../core/build/types'
import { FIRST_DESIGN, SCALE_UP, VIDEO_STREAMING, videoOf } from './build'

function win(task: BuildTask, placed: Placement, settings: Settings, seconds = 70) {
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
  it('wins with a CDN and a queue', () => {
    expect(win(FIRST_DESIGN, { u1: 'queue', v1: 'cache' }, {})).toBe(true)
  })
  it.each([
    ['no CDN', { u1: 'queue' } as Placement],
    ['no queue', { v1: 'cache' } as Placement],
    ['nothing', {} as Placement],
    ['a queue behind the transcoder', { d1: 'queue', v1: 'cache' } as Placement],
  ])('fails with %s', (_name, placed) => {
    expect(win(FIRST_DESIGN, placed, {})).toBe(false)
  })
})

const GOOD: Placement = { u1: 'queue', d0: 'autoscaler', v1: 'cache' }
const GOOD_SET: Settings = { chunks: 1, quality: 1, cache: 1, shield: 1 }
const without = (placed: Placement, ...ids: string[]) => Object.fromEntries(Object.entries(placed).filter(([id]) => !ids.includes(id))) as Placement

describe('where it breaks', () => {
  it('wins with the full design', () => {
    expect(win(SCALE_UP, GOOD, GOOD_SET)).toBe(true)
  })
  it('still wins with pieces it does not need, but they are flagged', () => {
    const placed = { ...GOOD, y1: 'ring', d1: 'breaker' } as Placement
    expect(win(SCALE_UP, placed, GOOD_SET)).toBe(true)
    expect(VIDEO_STREAMING.review(placed, GOOD_SET).lines.some((l) => !l.ok)).toBe(true)
  })
  it.each([
    ['no queue', without(GOOD, 'u1'), GOOD_SET],
    ['no autoscaler', without(GOOD, 'd0'), GOOD_SET],
    ['more transcoders but no autoscaler', { ...without(GOOD, 'd0'), w1: 'app', w2: 'app' } as Placement, GOOD_SET],
    ['no CDN', without(GOOD, 'v1'), GOOD_SET],
    ['long videos transcoded whole', GOOD, { ...GOOD_SET, chunks: 0 }],
    ['one quality', GOOD, { ...GOOD_SET, quality: 0 }],
    ['a CDN that keeps every video', GOOD, { ...GOOD_SET, cache: 0 }],
    ['no shared cache', GOOD, { ...GOOD_SET, shield: 0 }],
    ['a rate limiter on the uploads', { ...GOOD, w1: 'limiter' } as Placement, GOOD_SET],
    ['a rate limiter on the viewers', { ...GOOD, y1: 'limiter' } as Placement, GOOD_SET],
  ])('fails with %s', (_name, placed, settings) => {
    expect(win(SCALE_UP, placed, settings)).toBe(false)
  })
  it('names the symptom, not the cause', () => {
    const placed = without(GOOD, 'u1')
    const run = new Running(SCALE_UP.assemble(placed, GOOD_SET))
    for (let t = 0; t < 70 * 20; t++) run.step()
    const problem = SCALE_UP.problem?.(run.metrics(), placed, GOOD_SET, run.flow)
    expect(problem).toMatch(/upload|plays|stalled|ready/)
    expect(problem).not.toMatch(/queue|autoscal|CDN|shield/i)
    expect(videoOf.get(run.flow)).toBeDefined()
  })
})

describe('final review', () => {
  it('marks the reference design all right', () => {
    expect(VIDEO_STREAMING.review(GOOD, GOOD_SET).lines.every((l) => l.ok)).toBe(true)
  })
  it('flags a bare design', () => {
    expect(VIDEO_STREAMING.review({}, { chunks: 0, quality: 0, cache: 0, shield: 0 }).lines.filter((l) => !l.ok).length).toBe(7)
  })
})
