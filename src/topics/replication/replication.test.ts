import { describe, expect, it } from 'vitest'
import { stateAt } from '../../core/chapters'
import { CHAPTERS } from './chapters'
import { ReplicationSim } from './engine'
import type { ReplicationState } from './types'
import { PRIMARY_KEY, replicaKey, TICKS_PER_SECOND } from './world'

const seeded = (seed: number) => {
  let x = seed
  return () => (x = (x * 16807) % 2147483647) / 2147483647
}
const seeds = [1, 2, 3, 4, 5]

const BASE: ReplicationState = { rps: 4, replicas: 0, lag: 0.3, readFrom: 'replicas', failed: false, promoted: false }

function run(st: ReplicationState, seconds: number, seed = 1, sim = new ReplicationSim(seeded(seed))) {
  sim.apply(st)
  for (let t = 0; t < TICKS_PER_SECOND * seconds; t++) sim.step()
  return sim
}

describe('replication system', () => {
  it('one database drowns under heavy reads; replicas take the reads', () => {
    const alone = run({ ...BASE, rps: 10 }, 30).metrics
    expect(alone.errorRate).toBeGreaterThan(5)

    const m = run({ ...BASE, rps: 10, replicas: 2 }, 30).metrics
    expect(m.errorRate).toBeLessThan(1)
    expect(m.load[PRIMARY_KEY]).toBeLessThan(0.3)
    expect(m.load[replicaKey(0)]).toBeGreaterThan(m.load[PRIMARY_KEY])
  })

  it('short lag rarely shows old data; long lag often does, until own reads go to the primary', () => {
    // Averaged over a minute, sampled every few seconds.
    const at = (st: Partial<ReplicationState>) =>
      seeds.map((seed) => {
        const sim = new ReplicationSim(seeded(seed))
        const samples = Array.from({ length: 20 }, () => run({ ...BASE, rps: 8, replicas: 2, ...st }, 3, seed, sim).metrics)
        const mean = (f: (m: (typeof samples)[0]) => number) => samples.reduce((sum, m) => sum + (f(m) || 0), 0) / samples.length
        return { staleRate: mean((m) => m.staleRate), ownStaleRate: mean((m) => m.ownStaleRate) }
      })
    const short = at({})
    const long = at({ lag: 3 })
    const fixed = at({ lag: 3, readFrom: 'own' })
    expect(Math.max(...short.map((m) => m.staleRate))).toBeLessThan(2)
    expect(Math.min(...long.map((m) => m.staleRate))).toBeGreaterThan(5)
    expect(Math.min(...long.map((m) => m.ownStaleRate))).toBeGreaterThan(50)
    expect(Math.max(...fixed.map((m) => m.ownStaleRate))).toBe(0)
  })

  it('a dead primary stops writes but not reads, until a replica is promoted', () => {
    const st = { ...BASE, rps: 8, replicas: 3, lag: 2 }
    const sim = run(st, 20)
    run({ ...st, failed: true }, 10, 1, sim)
    const down = sim.metrics
    expect(down.errorRate).toBeGreaterThan(5)
    expect(down.errorRate).toBeLessThan(20)

    run({ ...st, failed: true, promoted: true }, 10, 1, sim)
    expect(sim.leaderKey).toBe(replicaKey(0))
    expect(sim.metrics.errorRate).toBeLessThan(1)
  })
})

// The replicas challenge, run exactly as the player checks it.
function solves(replicas: number, seed: number) {
  const chapter = CHAPTERS.find((c) => c.title === 'Read replicas')!
  const beatIdx = chapter.beats.findIndex((b) => b.challenge)
  const challenge = chapter.beats[beatIdx].challenge!
  const st = { ...stateAt(chapter, beatIdx), replicas }
  const sim = new ReplicationSim(seeded(seed))
  sim.apply(st)
  let streak = 0
  for (let t = 0; t < TICKS_PER_SECOND * 60; t++) {
    sim.step()
    streak = challenge.check({ m: sim.metrics, st, sim }) ? streak + 1 : 0
    if (streak >= challenge.holdSeconds * TICKS_PER_SECOND) return true
  }
  return false
}

describe('replicas challenge', () => {
  it('needs enough replicas', () => {
    expect(seeds.every((s) => !solves(0, s))).toBe(true)
    expect(seeds.every((s) => !solves(1, s))).toBe(true)
    expect(seeds.every((s) => solves(3, s))).toBe(true)
  })
})

// The read-your-own-writes challenge, for each choice of where reads go.
function solvesOwn(readFrom: ReplicationState['readFrom'], seed: number) {
  const chapter = CHAPTERS.find((c) => c.title === 'Read your own writes')!
  const beatIdx = chapter.beats.findIndex((b) => b.challenge)
  const challenge = chapter.beats[beatIdx].challenge!
  const st = { ...stateAt(chapter, beatIdx), readFrom }
  const sim = new ReplicationSim(seeded(seed))
  sim.apply(st)
  let streak = 0
  for (let t = 0; t < TICKS_PER_SECOND * 60; t++) {
    sim.step()
    streak = challenge.check({ m: sim.metrics, st, sim }) ? streak + 1 : 0
    if (streak >= challenge.holdSeconds * TICKS_PER_SECOND) return true
  }
  return false
}

describe('read your own writes challenge', () => {
  it('is solved only by sending your own reads to the primary', () => {
    expect(seeds.every((s) => solvesOwn('own', s))).toBe(true)
    expect(seeds.every((s) => !solvesOwn('replicas', s))).toBe(true)
    expect(seeds.every((s) => !solvesOwn('primary', s))).toBe(true)
  })
})
