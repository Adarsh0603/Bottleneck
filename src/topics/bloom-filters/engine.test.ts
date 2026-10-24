import { describe, expect, it } from 'vitest'
import { BloomSim, cellsFor } from './engine'
import type { BloomState } from './types'
import { TICKS_PER_SECOND } from './world'

const BASE: BloomState = { ask: 0, kind: 'new', pace: 0, taken: 20, filter: true, bits: 32, hashes: 1, names: 6, counting: false, drop: 0, round: 0 }

function run(sim: BloomSim, seconds: number) {
  for (let t = 0; t < TICKS_PER_SECOND * seconds; t++) sim.step()
}

// Starts clean and applies the state.
function start(st: Partial<BloomState> = {}) {
  const sim = new BloomSim()
  const state = { ...BASE, ...st }
  sim.apply(state)
  return { sim, state }
}

// Checks one name of the given kind and lets everything settle.
function check(sim: BloomSim, state: BloomState, kind: BloomState['kind']) {
  const next = { ...state, kind, ask: state.ask + 1 }
  sim.apply(next)
  run(sim, 5)
  return next
}

describe('bloom filter: hashing', () => {
  it('gives the same different positions every time', () => {
    for (let id = 0; id < 50; id++) {
      const a = cellsFor(id, 3, 32)
      expect(a).toEqual(cellsFor(id, 3, 32))
      expect(new Set(a).size).toBe(3)
      for (const c of a) expect(c).toBeLessThan(32)
    }
  })

  it('turns on every position of every saved name', () => {
    const { sim } = start({ hashes: 3 })
    for (const id of sim.names) for (const c of cellsFor(id, 3, 32)) expect(sim.isOn(c)).toBe(true)
  })
})

describe('bloom filter: checking names', () => {
  it('a new name whose switch is off is answered without the database', () => {
    const { sim, state } = start()
    check(sim, state, 'new')
    expect(sim.metrics).toMatchObject({ asked: 1, answered: 1, skipped: 1, trips: 0, wrong: 0 })
  })

  it('a saved name goes to the database and is found', () => {
    const { sim, state } = start()
    check(sim, state, 'taken')
    expect(sim.metrics).toMatchObject({ asked: 1, answered: 1, skipped: 0, trips: 1, wasted: 0, wrong: 0 })
  })

  it('a lookalike gets a maybe, wastes a trip, and is still answered right', () => {
    const { sim, state } = start()
    check(sim, state, 'lookalike')
    expect(sim.metrics).toMatchObject({ answered: 1, skipped: 0, trips: 1, wasted: 1, wrong: 0 })
  })

  it('without a filter every check goes to the database', () => {
    const { sim, state } = start({ filter: false })
    check(sim, state, 'new')
    expect(sim.metrics).toMatchObject({ answered: 1, skipped: 0, trips: 1, wasted: 1 })
  })

  it('never calls a saved name free', () => {
    const { sim } = start({ pace: 4, taken: 60, hashes: 2 })
    run(sim, 40)
    expect(sim.metrics.wrong).toBe(0)
    expect(sim.metrics.answered).toBeGreaterThan(20)
  })
})

describe('bloom filter: the database is slow', () => {
  it('lookups pile up without a filter and stay short with one', () => {
    const off = start({ filter: false, pace: 3 })
    run(off.sim, 20)
    const on = start({ pace: 3, bits: 128, hashes: 3 })
    run(on.sim, 20)
    expect(off.sim.metrics.queue).toBeGreaterThan(5)
    expect(on.sim.metrics.queue).toBeLessThan(off.sim.metrics.queue)
    expect(on.sim.metrics.trips).toBeLessThan(off.sim.metrics.trips)
  })
})

describe('bloom filter: more hashes and bigger strips', () => {
  it('more hashes lower the false-maybe chance while the strip is empty enough', () => {
    const one = start({ names: 4, bits: 32, hashes: 1 }).sim.metrics.fpPct
    const three = start({ names: 4, bits: 32, hashes: 3 }).sim.metrics.fpPct
    expect(three).toBeLessThan(one)
  })

  it('too many names fill the strip and the chance climbs', () => {
    const few = start({ names: 4, hashes: 3 }).sim.metrics
    const many = start({ names: 24, hashes: 3 }).sim.metrics
    expect(many.fillPct).toBeGreaterThan(few.fillPct)
    expect(many.fpPct).toBeGreaterThan(40)
  })

  it('a bigger strip brings it back down', () => {
    expect(start({ names: 16, bits: 128, hashes: 3 }).sim.metrics.fpPct).toBeLessThan(5)
  })

  it('adding names keeps the counts, shrinking rebuilds', () => {
    const { sim, state } = start({ names: 4 })
    check(sim, state, 'taken')
    sim.apply({ ...state, names: 8, ask: 1 })
    expect(sim.metrics.asked).toBe(1)
    expect(sim.names.size).toBe(8)
  })
})

describe('bloom filter: deleting', () => {
  const del = { names: 8, bits: 32, hashes: 3 }

  it('clearing switches makes a neighbour look free', () => {
    const { sim, state } = start(del)
    sim.apply({ ...state, drop: 1 })
    run(sim, 1)
    const next = check(sim, { ...state, drop: 1 }, 'friend')
    expect(next.ask).toBe(1)
    expect(sim.metrics).toMatchObject({ deleted: 1, wrong: 1, skipped: 1 })
  })

  it('counting switches keep the neighbour findable', () => {
    const { sim, state } = start({ ...del, counting: true })
    sim.apply({ ...state, drop: 1 })
    run(sim, 1)
    check(sim, { ...state, drop: 1 }, 'friend')
    expect(sim.metrics).toMatchObject({ deleted: 1, wrong: 0, trips: 1 })
  })

  it('the deleted name is free afterwards', () => {
    const { sim, state } = start({ ...del, counting: true })
    sim.apply({ ...state, drop: 1 })
    run(sim, 1)
    expect(sim.names.size).toBe(7)
  })
})
