import { describe, expect, it } from 'vitest'
import { ConsensusSim } from './engine'
import type { ConsensusState } from './types'
import { TICKS_PER_SECOND } from './world'

const seeded = (seed: number) => {
  let x = seed
  return () => (x = (x * 16807) % 2147483647) / 2147483647
}
const seeds = [1, 2, 3, 4, 5]

const BASE: ConsensusState = { size: 3, pace: 0.5, manual: false, again: 0, rule: 'leader', elections: true, down: [], split: 0, timeout: 3, spread: 3 }

function run(st: ConsensusState, seconds: number, seed = 1, sim = new ConsensusSim(seeded(seed))) {
  // The leader is the first server up when the rule starts, so start clean.
  if (sim.tick === 0) sim.apply({ ...st, down: [], split: 0 })
  sim.apply(st)
  for (let t = 0; t < TICKS_PER_SECOND * seconds; t++) sim.step()
  return sim
}

// Every seat appears at most once in a ledger, whoever holds it.
const seatsOnce = (sim: ConsensusSim) =>
  sim.active.every((n) => new Set(n.log.map((e) => e.seat)).size === n.log.length)

describe('consensus: no leader', () => {
  it('lets two servers sell the same seat', () => {
    for (const seed of seeds) {
      const sim = run({ ...BASE, rule: 'anyone', elections: false }, 20, seed)
      expect(sim.metrics.clashTotal).toBeGreaterThan(2)
    }
  })
})

describe('consensus: one race at a time', () => {
  const MANUAL = { ...BASE, rule: 'anyone' as const, elections: false, manual: true }

  it('holds still until asked, then runs exactly one race per request', () => {
    const sim = run(MANUAL, 10)
    expect(sim.metrics.confirmed).toBe(0)
    run({ ...MANUAL, again: 1 }, 10, 1, sim)
    expect(sim.metrics.clashTotal).toBe(1)
    expect(sim.metrics.confirmed).toBe(2)
    run({ ...MANUAL, again: 2 }, 10, 1, sim)
    expect(sim.metrics.clashTotal).toBe(2)
  })
})

describe('consensus: one leader', () => {
  it('sells every seat once, and confirms bookings', () => {
    for (const seed of seeds) {
      const sim = run({ ...BASE, elections: false }, 30, seed)
      const m = sim.metrics
      expect(m.clashTotal).toBe(0)
      expect(m.confirmed).toBeGreaterThan(8)
      expect(m.waiting).toBeLessThan(6)
      expect(m.leader).toBe(0)
      expect(seatsOnce(sim)).toBe(true)
    }
  })

  it('every follower ends up with the leader’s ledger', () => {
    const sim = run({ ...BASE, pace: 0, elections: false }, 1)
    const st = { ...BASE, pace: 1, elections: false }
    run(st, 20, 1, sim)
    run({ ...st, pace: 0 }, 4, 1, sim)
    const lead = sim.nodes[0]
    for (const n of sim.active) expect(n.log.map((e) => e.seat)).toEqual(lead.log.map((e) => e.seat))
  })

  it('without elections, a dead leader stalls everything', () => {
    const sim = run({ ...BASE, elections: false, down: [0] }, 20)
    const m = sim.metrics
    expect(m.leader).toBeNull()
    expect(m.stall).toBeGreaterThan(15)
    expect(m.confirmed).toBe(0)
    expect(m.waiting).toBeGreaterThan(3)
  })
})

describe('consensus: elections', () => {
  it('elects a new leader after the old one dies, and bookings go on', () => {
    for (const seed of seeds) {
      const sim = run(BASE, 10, seed)
      const before = sim.metrics.confirmed
      run({ ...BASE, down: [0] }, 40, seed, sim)
      const m = sim.metrics
      expect(m.leader).not.toBeNull()
      expect(m.leader).not.toBe(0)
      expect(m.leaders).toBe(1)
      expect(m.term).toBeGreaterThan(1)
      expect(m.stall).toBe(0)
      expect(m.confirmed).toBeGreaterThan(before + 3)
      expect(m.clashTotal).toBe(0)
    }
  })

  it('never has two leaders in one term', () => {
    for (const seed of seeds) {
      const sim = new ConsensusSim(seeded(seed))
      const st = { ...BASE, size: 5 as const, spread: 0.2, down: [0] }
      sim.apply({ ...st, down: [] })
      sim.apply(st)
      for (let t = 0; t < TICKS_PER_SECOND * 40; t++) {
        sim.step()
        const terms = sim.active.filter((n) => n.alive && n.role === 'leader').map((n) => n.term)
        expect(new Set(terms).size).toBe(terms.length)
      }
    }
  })

  it('a minority cannot elect a leader', () => {
    // 5 servers: the leader is down and 2 more are cut off, leaving 2 of 5.
    const sim = run({ ...BASE, size: 5, down: [0], split: 2 }, 30)
    expect(sim.metrics.leader).toBeNull()
    expect(sim.nodes.every((n) => n.role !== 'leader' || !n.alive)).toBe(true)
  })

  it('the majority side of a split carries on', () => {
    const sim = run({ ...BASE, size: 5, split: 2, down: [0] }, 30)
    const m = sim.metrics
    // nodes 1 and 2 plus 3, 4 cut off: only 2 of 5 are connected and alive
    expect(m.leader).toBeNull()
    const ok = run({ ...BASE, size: 5, split: 2 }, 30)
    expect(ok.metrics.leader).toBe(0)
    expect(ok.metrics.confirmed).toBeGreaterThan(5)
  })

  it('never loses a confirmed booking across a change of leader', () => {
    for (const seed of seeds) {
      const sim = run({ ...BASE, size: 5, pace: 1 }, 10, seed)
      run({ ...BASE, size: 5, pace: 1, down: [0] }, 15, seed, sim)
      run({ ...BASE, size: 5, pace: 1, down: [] }, 15, seed, sim)
      const lead = sim.leader!
      expect(lead).not.toBeNull()
      const held = new Set(lead.log.slice(0, lead.commit).map((e) => e.req))
      const owners = [...(sim as unknown as { owners: Map<number, Set<string>> }).owners]
      expect(owners.every(([, o]) => o.size === 1)).toBe(true)
      expect(seatsOnce(sim)).toBe(true)
      expect(held.size).toBeGreaterThan(10)
    }
  })
})
