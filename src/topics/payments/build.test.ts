import { describe, expect, it } from 'vitest'
import { Running } from '../../core/build/run'
import type { BuildTask, Placement, Settings } from '../../core/build/types'
import { FIRST_DESIGN, PAYMENTS, SCALE_UP, payOf } from './build'

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
  it('wins with a store and one key for the whole order', () => {
    expect(win(FIRST_DESIGN, { m1: 'dedupe' }, { key: 2 })).toBe(true)
    expect(win(FIRST_DESIGN, { m1: 'breaker', m2: 'dedupe' }, { key: 2 })).toBe(true)
  })
  it.each([
    ['no store', {} as Placement, { key: 2 }],
    ['a new key for every click', { m1: 'dedupe' } as Placement, { key: 1 }],
    ['a new key for every try', { m1: 'dedupe' } as Placement, { key: 0 }],
    ['the store in front of checkout', { l1: 'dedupe' } as Placement, { key: 2 }],
  ])('fails with %s', (_name, placed, settings) => {
    expect(win(FIRST_DESIGN, placed, settings)).toBe(false)
  })
})

const GOOD: Placement = { m1: 'breaker', m2: 'dedupe', q1: 'queue' }
// One key per order, a 1 second timeout, retries, and the order written down first.
const GOOD_SET: Settings = { key: 2, timeout: 2, retry: 1, crash: 1 }
const without = (placed: Placement, ...ids: string[]) => Object.fromEntries(Object.entries(placed).filter(([id]) => !ids.includes(id))) as Placement

describe('where it breaks', () => {
  it('wins with the full design', () => {
    expect(win(SCALE_UP, GOOD, GOOD_SET)).toBe(true)
  })
  it('still wins with a piece it does not need, but it is flagged', () => {
    const placed = { ...GOOD, d0: 'ring' } as Placement
    expect(win(SCALE_UP, placed, GOOD_SET)).toBe(true)
    expect(PAYMENTS.review(placed, GOOD_SET).lines.some((l) => !l.ok)).toBe(true)
  })
  it.each([
    ['a new key for every click', GOOD, { ...GOOD_SET, key: 1 }],
    ['a new key for every try', GOOD, { ...GOOD_SET, key: 0 }],
    ['no idempotency store', without(GOOD, 'm2'), GOOD_SET],
    ['a 10 second timeout', GOOD, { ...GOOD_SET, timeout: 0 }],
    ['a 3 second timeout', GOOD, { ...GOOD_SET, timeout: 1 }],
    ['no retries', GOOD, { ...GOOD_SET, retry: 0 }],
    ['nothing kept after a crash', GOOD, { ...GOOD_SET, crash: 0 }],
    ['refunds after a crash', GOOD, { ...GOOD_SET, crash: 2 }],
    ['no breaker', without(GOOD, 'm1'), GOOD_SET],
    ['no queue', without(GOOD, 'q1'), GOOD_SET],
    ['a rate limiter in front of checkout', { ...GOOD, d0: 'limiter' } as Placement, GOOD_SET],
    ['a rate limiter on the road', { ...GOOD, d1: 'limiter' } as Placement, GOOD_SET],
  ])('fails with %s', (_name, placed, settings) => {
    expect(win(SCALE_UP, placed, settings)).toBe(false)
  })
  it('jams when the store stands nearer checkout than the breaker', () => {
    const placed: Placement = { m1: 'dedupe', m2: 'breaker', q1: 'queue' }
    expect(win(SCALE_UP, placed, GOOD_SET)).toBe(false)
    const run = new Running(SCALE_UP.assemble(placed, GOOD_SET))
    for (let t = 0; t < 100; t++) run.step()
    expect(SCALE_UP.problem?.(run.metrics(), placed, GOOD_SET, run.flow)).toMatch(/breaker has to stand in front/)
  })
  it('says where a queue in front of checkout cannot work', () => {
    const placed: Placement = { ...without(GOOD, 'q1'), l1: 'queue' }
    const run = new Running(SCALE_UP.assemble(placed, GOOD_SET))
    for (let t = 0; t < 100; t++) run.step()
    expect(SCALE_UP.problem?.(run.metrics(), placed, GOOD_SET, run.flow)).toMatch(/queue has to stand behind checkout/)
  })
  it.each([0, 2])('says what the crash cost, with crash handling %i', (crash) => {
    const settings = { ...GOOD_SET, crash }
    const run = new Running(SCALE_UP.assemble(GOOD, settings))
    for (let t = 0; t < 70 * 20 && !SCALE_UP.requirements?.some((r) => !r.read(run.flow, run.metrics()).ok); t++) run.step()
    const problem = SCALE_UP.problem?.(run.metrics(), GOOD, settings, run.flow)
    expect(problem).toMatch(/Checkout crashed with \d+ orders in progress\. \d+ of them were lost/)
    expect(problem).not.toMatch(/written down|refund|recover/i)
  })
  it('names the symptom, not the cause', () => {
    const placed = without(GOOD, 'm2')
    const run = new Running(SCALE_UP.assemble(placed, GOOD_SET))
    for (let t = 0; t < 40; t++) run.step()
    const problem = SCALE_UP.problem?.(run.metrics(), placed, GOOD_SET, run.flow)
    expect(problem).toMatch(/charged twice/)
    expect(problem).not.toMatch(/idempoten|store|key/i)
    expect(payOf.get(run.flow)).toBeDefined()
  })
})

describe('final review', () => {
  it('marks the reference design all right', () => {
    expect(PAYMENTS.review(GOOD, GOOD_SET).lines.every((l) => l.ok)).toBe(true)
  })
  it('flags a bare design', () => {
    expect(PAYMENTS.review({}, { key: 0 }).lines.filter((l) => !l.ok).length).toBe(6)
  })
})
