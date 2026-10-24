import { describe, expect, it } from 'vitest'
import { stateAt } from '../../core/chapters'
import { CHAPTERS } from './chapters'
import { CapSim } from './engine'
import type { CapState } from './types'
import { TICKS_PER_SECOND } from './world'

const seeded = (seed: number) => {
  let x = seed
  return () => (x = (x * 16807) % 2147483647) / 2147483647
}
const seeds = [1, 2, 3, 4, 5]

const BASE: CapState = { rps: 6, partitioned: false, mode: 'available' }

function run(st: CapState, seconds: number, seed = 1, sim = new CapSim(seeded(seed))) {
  sim.apply(st)
  for (let t = 0; t < TICKS_PER_SECOND * seconds; t++) sim.step()
  return sim
}

describe('cap system', () => {
  it('with the link up, no one is turned away and nothing is stale', () => {
    for (const mode of ['consistent', 'available'] as const) {
      const m = run({ ...BASE, mode }, 20).metrics
      expect(m.errorRate).toBeLessThan(1)
      expect(m.staleRate).toBe(0)
    }
  })

  it('cut and consistent: East turns users away, and nothing stale is served', () => {
    const m = run({ ...BASE, partitioned: true, mode: 'consistent' }, 20).metrics
    expect(m.errorRate).toBeGreaterThan(30)
    expect(m.staleRate).toBe(0)
    expect(m.conflicts).toBe(0)
  })

  it('cut and available: no one is turned away, but old data is served', () => {
    const m = run({ ...BASE, partitioned: true, mode: 'available' }, 20).metrics
    expect(m.errorRate).toBeLessThan(1)
    expect(m.staleRate).toBeGreaterThan(0)
  })

  it('writes on both sides collide while available, and not while consistent', () => {
    const open = run({ ...BASE, rps: 10, partitioned: true, mode: 'available' }, 20).metrics
    expect(open.conflicts).toBeGreaterThan(0)
    const closed = run({ ...BASE, rps: 10, partitioned: true, mode: 'consistent' }, 20).metrics
    expect(closed.conflicts).toBe(0)
  })

  it('healing settles the conflicts and ends the stale reads', () => {
    const sim = run({ ...BASE, rps: 10, partitioned: true }, 15)
    const before = sim.metrics.conflicts
    expect(before).toBeGreaterThan(0)
    run({ ...BASE, rps: 10, partitioned: false }, 10, 1, sim)
    expect(sim.metrics.conflicts).toBe(before)
    expect(sim.metrics.staleRate).toBe(0)
  })
})

// Each challenge is solved by the intended choice only.
function solves(title: string, over: Partial<CapState>, seed: number) {
  const chapter = CHAPTERS.find((c) => c.title === title)!
  const idx = chapter.beats.findIndex((b) => b.challenge)
  const challenge = chapter.beats[idx].challenge!
  const st = { ...stateAt(chapter, idx), ...over }
  const sim = new CapSim(seeded(seed))
  sim.apply(st)
  let streak = 0
  for (let t = 0; t < TICKS_PER_SECOND * 60; t++) {
    sim.step()
    streak = challenge.check({ m: sim.metrics, st, sim }) ? streak + 1 : 0
    if (streak >= challenge.holdSeconds * TICKS_PER_SECOND) return true
  }
  return false
}

describe('challenges', () => {
  it('Choose consistency is solved only by refusing', () => {
    expect(seeds.every((s) => solves('Choose consistency', { mode: 'consistent' }, s))).toBe(true)
    expect(seeds.every((s) => !solves('Choose consistency', { mode: 'available' }, s))).toBe(true)
  })

  it('Choose availability is solved only by answering', () => {
    expect(seeds.every((s) => solves('Choose availability', { mode: 'available' }, s))).toBe(true)
    expect(seeds.every((s) => !solves('Choose availability', { mode: 'consistent' }, s))).toBe(true)
  })
})
