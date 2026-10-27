import { describe, expect, it } from 'vitest'
import { Running } from '../../core/build/run'
import type { BuildTask, Placement, Settings } from '../../core/build/types'
import { CHAT, FIRST_DESIGN, SCALE_UP, chatOf } from './build'

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

describe('first design', () => {
  it('wins with two gateways and a topic', () => {
    expect(win(FIRST_DESIGN, { g1: 'app', t1: 'topic' }, {})).toBe(true)
  })
  it.each([
    ['one gateway', { t1: 'topic' } as Placement],
    ['no topic', { g1: 'app' } as Placement],
    ['nothing', {} as Placement],
  ])('fails with %s', (_name, placed) => {
    expect(win(FIRST_DESIGN, placed, {})).toBe(false)
  })
})

const GOOD: Placement = { g1: 'app', g2: 'app', t1: 'topic', q1: 'queue', d1: 'dedupe' }
const GOOD_SET: Settings = { order: 1, group: 1, retry: 1 }
const without = (placed: Placement, ...ids: string[]) => Object.fromEntries(Object.entries(placed).filter(([id]) => !ids.includes(id))) as Placement

describe('where it breaks', () => {
  it('wins with the full design', () => {
    expect(win(SCALE_UP, GOOD, GOOD_SET)).toBe(true)
  })
  it('still wins with pieces it does not need, but they are flagged', () => {
    const placed = { ...GOOD, x1: 'ring', x2: 'breaker' } as Placement
    expect(win(SCALE_UP, placed, GOOD_SET)).toBe(true)
    expect(CHAT.review(placed, GOOD_SET).lines.some((l) => !l.ok)).toBe(true)
  })
  it.each([
    ['no topic', without(GOOD, 't1'), GOOD_SET],
    ['no inbox', without(GOOD, 'q1'), GOOD_SET],
    ['no dedupe store', without(GOOD, 'd1'), GOOD_SET],
    ['one gateway fewer', without(GOOD, 'g2'), GOOD_SET],
    ['messages put in order by arrival', GOOD, { ...GOOD_SET, order: 0 }],
    ['a group message stored for every member', GOOD, { ...GOOD_SET, group: 0 }],
    ['phones that retry right away', GOOD, { ...GOOD_SET, retry: 0 }],
    ['a rate limiter', { ...GOOD, x1: 'limiter' } as Placement, GOOD_SET],
  ])('fails with %s', (_name, placed, settings) => {
    expect(win(SCALE_UP, placed, settings)).toBe(false)
  })
  it('names the symptom, not the cause', () => {
    const placed = without(GOOD, 'd1')
    const run = new Running(SCALE_UP.assemble(placed, GOOD_SET))
    for (let t = 0; t < 70 * 20; t++) run.step()
    const problem = SCALE_UP.problem?.(run.metrics(), placed, GOOD_SET, run.flow)
    expect(problem).toMatch(/twice|lost|connect|arrive/)
    expect(problem).not.toMatch(/dedupe|id/i)
    expect(chatOf.get(run.flow)).toBeDefined()
  })
})

describe('final review', () => {
  it('marks the reference design all right', () => {
    expect(CHAT.review(GOOD, GOOD_SET).lines.every((l) => l.ok)).toBe(true)
  })
  it('flags a bare design', () => {
    expect(CHAT.review({}, { order: 0, group: 0, retry: 0 }).lines.filter((l) => !l.ok).length).toBe(7)
  })
})
