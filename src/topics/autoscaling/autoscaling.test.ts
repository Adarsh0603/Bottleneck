import { describe, expect, it } from 'vitest'
import { stateAt } from '../../core/chapters'
import { CHAPTERS } from './chapters'
import { AutoscaleSim } from './engine'
import type { AutoscaleState } from './types'
import { MAX_SERVERS, TICKS_PER_SECOND } from './world'

const seeded = (seed: number) => {
  let x = seed
  return () => (x = (x * 16807) % 2147483647) / 2147483647
}
const seeds = [1, 2, 3, 4, 5]

const DAY: AutoscaleState = { pattern: 'day', rps: 0, servers: 2, auto: false, target: 60, min: 2, bootSeconds: 2 }

// Run a whole day; return the worst error rate seen and the fleet sizes.
function day(st: AutoscaleState, seed: number) {
  const sim = new AutoscaleSim(seeded(seed))
  sim.apply(st)
  let worst = 0
  const fleets: number[] = []
  for (let t = 0; t < TICKS_PER_SECOND * 24; t++) {
    sim.step()
    worst = Math.max(worst, sim.metrics.dropRate)
    fleets.push(sim.fleet)
  }
  return { worst, fleets }
}

describe('autoscaling system', () => {
  it('a fixed fleet is either too small at noon or idle at night', () => {
    expect(day({ ...DAY, servers: 2 }, 1).worst).toBeGreaterThan(10)
    expect(day({ ...DAY, servers: 6 }, 1).worst).toBe(0)
  })

  it('the autoscaler follows a day of traffic without errors', () => {
    for (const s of seeds) {
      const { worst, fleets } = day({ ...DAY, auto: true }, s)
      expect(worst).toBeLessThan(5)
      expect(Math.max(...fleets)).toBeGreaterThanOrEqual(5)
      expect(Math.min(...fleets.slice(TICKS_PER_SECOND * 2))).toBeLessThanOrEqual(3)
    }
  })

  it('new servers take traffic only once booted, and removed ones drain first', () => {
    const sim = new AutoscaleSim(seeded(1))
    sim.apply({ ...DAY, pattern: 'steady', rps: 3, auto: true, bootSeconds: 3 })
    sim.apply({ ...DAY, pattern: 'steady', rps: 3, auto: true, bootSeconds: 3, min: 4 })
    for (let t = 0; t < TICKS_PER_SECOND * 1.5; t++) sim.step()
    const booting = sim.slots.filter((s) => s?.state === 'booting')
    expect(booting.length).toBe(2)
    expect(booting.every((s) => s!.worker.served === 0 && s!.worker.load() === 0)).toBe(true)
    for (let t = 0; t < TICKS_PER_SECOND * 4; t++) sim.step()
    expect(sim.slots.filter((s) => s?.state === 'running').length).toBe(4)

    sim.apply({ ...DAY, pattern: 'steady', rps: 3, auto: false, servers: 1 })
    expect(sim.fleet).toBe(1)
    for (let t = 0; t < TICKS_PER_SECOND * 5; t++) sim.step()
    expect(sim.slots.filter(Boolean).length).toBe(1)
    expect(sim.flow.stats.dropped).toBe(0)
  })

  it('never runs more than the slots it has', () => {
    const { fleets } = day({ ...DAY, auto: true, target: 20 }, 1)
    expect(Math.max(...fleets)).toBeLessThanOrEqual(MAX_SERVERS)
  })
})

// The spike challenge, run exactly as the player checks it.
function solvesSpike(target: number, seed: number) {
  const chapter = CHAPTERS.find((c) => c.title === 'Boot time')!
  const beatIdx = chapter.beats.findIndex((b) => b.challenge)
  const challenge = chapter.beats[beatIdx].challenge!
  const st = { ...stateAt(chapter, beatIdx), target }
  const sim = new AutoscaleSim(seeded(seed))
  sim.apply(st)
  let streak = 0
  for (let t = 0; t < TICKS_PER_SECOND * 50; t++) {
    sim.step()
    streak = challenge.check({ m: sim.metrics, st, sim }) ? streak + 1 : 0
    if (streak >= challenge.holdSeconds * TICKS_PER_SECOND) return true
  }
  return false
}

describe('spike challenge', () => {
  it('needs a low target, for spare servers while new ones boot', () => {
    expect(seeds.every((s) => solvesSpike(30, s))).toBe(true)
    expect(seeds.every((s) => !solvesSpike(50, s))).toBe(true)
    expect(seeds.every((s) => !solvesSpike(70, s))).toBe(true)
  })
})
