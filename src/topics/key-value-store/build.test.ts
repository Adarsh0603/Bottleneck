import { describe, expect, it } from 'vitest'
import { Running } from '../../core/build/run'
import type { BuildTask, Placement, Settings } from '../../core/build/types'
import { FIRST_DESIGN, KEY_VALUE_STORE, SCALE_UP, kvOf } from './build'

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
  it('wins with a ring and three nodes', () => {
    expect(win(FIRST_DESIGN, { r1: 'ring', n1: 'database', n2: 'database', n3: 'database' }, {})).toBe(true)
  })
  it.each([
    ['one node', { r1: 'ring', n1: 'database' } as Placement],
    ['two nodes', { r1: 'ring', n1: 'database', n2: 'database' } as Placement],
    ['no ring', { n1: 'database', n2: 'database', n3: 'database' } as Placement],
    ['nothing', {} as Placement],
    ['a ring in front of the coordinator', { l1: 'ring', n1: 'database', n2: 'database', n3: 'database' } as Placement],
  ])('fails with %s', (_name, placed) => {
    expect(win(FIRST_DESIGN, placed, {})).toBe(false)
  })
})

const GOOD: Placement = { r1: 'ring', c1: 'cache', n1: 'database', n2: 'database', n3: 'database', n4: 'database', n5: 'database' }
// Three copies, read 2, write 2, stand-in on, fix on read, counter, many slices.
const GOOD_SET: Settings = { copies: 2, readq: 1, writeq: 1, handoff: 1, repair: 1, stamp: 1, slices: 1 }
const without = (placed: Placement, ...ids: string[]) => Object.fromEntries(Object.entries(placed).filter(([id]) => !ids.includes(id))) as Placement

describe('where it breaks', () => {
  it('wins with the full design', () => {
    expect(win(SCALE_UP, GOOD, GOOD_SET)).toBe(true)
  })
  it('still wins with pieces it does not need, but they are flagged', () => {
    const placed = { ...GOOD, b1: 'breaker' } as Placement
    expect(win(SCALE_UP, placed, GOOD_SET)).toBe(true)
    expect(KEY_VALUE_STORE.review(placed, GOOD_SET).lines.some((l) => !l.ok)).toBe(true)
  })
  it.each([
    ['one copy', GOOD, { ...GOOD_SET, copies: 0, readq: 0, writeq: 0 }],
    ['quorums that do not overlap', GOOD, { ...GOOD_SET, readq: 0, writeq: 0 }],
    ['every node must answer a write', GOOD, { ...GOOD_SET, writeq: 2 }],
    ['clock time for versions', GOOD, { ...GOOD_SET, stamp: 0 }],
    ['neither a stand-in nor fixes on read', GOOD, { ...GOOD_SET, handoff: 0, repair: 0 }],
    ['one big slice per node', GOOD, { ...GOOD_SET, slices: 0 }],
    ['no cache for the hot key', without(GOOD, 'c1'), GOOD_SET],
    ['no ring', without(GOOD, 'r1'), GOOD_SET],
    ['a rate limiter in front', { ...GOOD, l1: 'limiter' } as Placement, GOOD_SET],
  ])('fails with %s', (_name, placed, settings) => {
    expect(win(SCALE_UP, placed, settings)).toBe(false)
  })
  it('names the symptom, not the cause', () => {
    const placed = without(GOOD, 'c1')
    const settings = { ...GOOD_SET, stamp: 0 }
    const run = new Running(SCALE_UP.assemble(placed, settings))
    for (let t = 0; t < 90 * 20; t++) run.step()
    const problem = SCALE_UP.problem?.(run.metrics(), placed, settings, run.flow)
    expect(problem).toMatch(/read|operations|copies/)
    expect(problem).not.toMatch(/clock|counter|quorum|cache|ring/i)
    expect(kvOf.get(run.flow)).toBeDefined()
  })
})

describe('final review', () => {
  it('marks the reference design all right', () => {
    expect(KEY_VALUE_STORE.review(GOOD, GOOD_SET).lines.every((l) => l.ok)).toBe(true)
  })
  it('flags a bare design', () => {
    expect(KEY_VALUE_STORE.review({}, {}).lines.filter((l) => !l.ok).length).toBe(8)
  })
})
