import { describe, expect, it } from 'vitest'
import { stateAt } from '../../core/chapters'
import { CHAPTERS } from './chapters'
import { ConsistentSim } from './engine'
import { assign, KEY_COUNT, shares } from './ring'
import type { ConsistentState } from './types'
import { TICKS_PER_SECOND } from './world'

const seeded = (seed: number) => {
  let x = seed
  return () => (x = (x * 16807) % 2147483647) / 2147483647
}
const seeds = [1, 2, 3, 4, 5]

function run(st: ConsistentState, seconds: number, sim: ConsistentSim) {
  sim.apply(st)
  for (let t = 0; t < TICKS_PER_SECOND * seconds; t++) sim.step()
  return sim
}

const moved = (a: number[], b: number[]) => a.filter((o, k) => o !== b[k]).length / KEY_COUNT
const nodes = (n: number) => Array.from({ length: n }, (_, i) => i)

describe('ring', () => {
  it('hash % N moves most items when a server is added; the ring moves few', () => {
    for (const n of [3, 4, 5]) {
      expect(moved(assign(nodes(n), 'mod', 1), assign(nodes(n + 1), 'mod', 1))).toBeGreaterThan(0.6)
      expect(moved(assign(nodes(n), 'ring', 8), assign(nodes(n + 1), 'ring', 8))).toBeLessThan(0.35)
    }
  })

  it('a ring server only gives up items to the new one, never to each other', () => {
    const before = assign(nodes(4), 'ring', 8)
    const after = assign(nodes(5), 'ring', 8)
    expect(before.every((o, k) => after[k] === o || after[k] === 4)).toBe(true)
  })

  it('one spot per server is lopsided; many spots even it out', () => {
    expect(Math.max(...shares(assign(nodes(5), 'ring', 1), nodes(5)))).toBeGreaterThan(0.4)
    expect(Math.max(...shares(assign(nodes(5), 'ring', 8), nodes(5)))).toBeLessThan(0.31)
  })
})

describe('consistent hashing system', () => {
  const base: ConsistentState = { rps: 16, nodes: 4, mode: 'mod', points: 8, down: null }

  it('adding a server with hash % N sends the traffic to the database; the ring does not', () => {
    for (const seed of seeds) {
      const mod = run({ ...base, nodes: 5 }, 5, run(base, 20, new ConsistentSim(seeded(seed))))
      expect(mod.metrics.errorRate).toBeGreaterThan(10)
      const ring = run({ ...base, mode: 'ring', nodes: 5 }, 5, run({ ...base, mode: 'ring' }, 20, new ConsistentSim(seeded(seed))))
      expect(ring.metrics.errorRate).toBeLessThan(1)
    }
  })

  it('a dead ring server swamps its neighbour unless servers have many spots', () => {
    const st: ConsistentState = { rps: 20, nodes: 5, mode: 'ring', points: 1, down: null }
    for (const seed of seeds) {
      const one = run({ ...st, down: 2 }, 6, run(st, 20, new ConsistentSim(seeded(seed))))
      expect(one.metrics.errorRate).toBeGreaterThan(5)
      const many = { ...st, points: 8 }
      const eight = run({ ...many, down: 2 }, 6, run(many, 20, new ConsistentSim(seeded(seed))))
      expect(eight.metrics.errorRate).toBeLessThan(1)
      expect(eight.metrics.maxLoad).toBeLessThan(0.85)
    }
  })
})

// A chapter's challenge, run exactly as the player checks it. `steps` change
// the state once the chapter's own setup has settled.
function solves(title: string, steps: Partial<ConsistentState>[], seed: number) {
  const chapter = CHAPTERS.find((c) => c.title === title)!
  const beatIdx = chapter.beats.findIndex((b) => b.challenge)
  const challenge = chapter.beats[beatIdx].challenge!
  let st = stateAt(chapter, beatIdx)
  const sim = new ConsistentSim(seeded(seed))
  sim.apply(st)
  for (let t = 0; t < TICKS_PER_SECOND * 20; t++) sim.step()
  let streak = 0
  for (const step of [...steps, {}]) {
    st = { ...st, ...step }
    sim.apply(st)
    for (let t = 0; t < TICKS_PER_SECOND * 30; t++) {
      sim.step()
      streak = challenge.check({ m: sim.metrics, st, sim }) ? streak + 1 : 0
      if (streak >= challenge.holdSeconds * TICKS_PER_SECOND) return true
    }
  }
  return false
}

describe('spots challenge', () => {
  it('needs more than one spot per server', () => {
    expect(seeds.every((s) => !solves('Even it out', [], s))).toBe(true)
    expect(seeds.every((s) => solves('Even it out', [{ points: 8 }], s))).toBe(true)
  })
})
