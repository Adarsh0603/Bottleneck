import { describe, expect, it } from 'vitest'
import { stateAt } from '../../core/chapters'
import { CHAPTERS } from './chapters'
import { BloomSim } from './engine'
import type { BloomState } from './types'
import { TICKS_PER_SECOND } from './world'

// The state at a chapter's practice challenge, with its checker.
function challenge(chapter: number) {
  const ch = CHAPTERS[chapter]
  const beat = ch.beats.findIndex((b) => b.challenge)
  return { st: stateAt(ch, beat), goal: ch.beats[beat].challenge! }
}

function play(st: BloomState, steps: ((s: BloomState) => BloomState)[], seconds = 10) {
  const sim = new BloomSim()
  let cur = st
  sim.apply(cur)
  for (const step of steps) {
    cur = step(cur)
    sim.apply(cur)
    for (let t = 0; t < TICKS_PER_SECOND * seconds; t++) sim.step()
  }
  return { sim, st: cur }
}

const ask = (kind: BloomState['kind']) => (s: BloomState) => ({ ...s, ask: s.ask + 1, kind })

describe('bloom filter challenges', () => {
  it('a cheap no: not won until the filter is on, then won', () => {
    const { st, goal } = challenge(1)
    const idle = play(st, [(s) => s], 15)
    expect(goal.check({ m: idle.sim.metrics, st: idle.st, sim: idle.sim })).toBe(false)
    const won = play(st, [(s) => ({ ...s, filter: true })], 15)
    expect(goal.check({ m: won.sim.metrics, st: won.st, sim: won.sim })).toBe(true)
  })

  it('when it says maybe: needs both lookalikes and new names', () => {
    const { st, goal } = challenge(2)
    const one = play(st, [ask('lookalike'), ask('lookalike'), ask('lookalike')], 5)
    expect(goal.check({ m: one.sim.metrics, st: one.st, sim: one.sim })).toBe(false)
    const both = play(st, [ask('lookalike'), ask('lookalike'), ask('lookalike'), ask('new'), ask('new')], 5)
    expect(goal.check({ m: both.sim.metrics, st: both.st, sim: both.sim })).toBe(true)
  })

  it('more switches per name: one hash is not enough, two or three are', () => {
    const { st, goal } = challenge(3)
    for (const [hashes, wins] of [[1, false], [2, true], [3, true], [4, true]] as const) {
      const r = play(st, [(s) => ({ ...s, hashes })], 1)
      expect(goal.check({ m: r.sim.metrics, st: r.st, sim: r.sim }), `${hashes} hashes`).toBe(wins)
    }
  })

  it('filling up: only a big strip wins with 16 names', () => {
    const { st, goal } = challenge(4)
    expect(st.names).toBe(16)
    const wins: string[] = []
    for (const bits of [16, 32, 64, 128]) {
      for (const hashes of [1, 2, 3, 4]) {
        const r = play(st, [(s) => ({ ...s, bits, hashes })], 1)
        if (goal.check({ m: r.sim.metrics, st: r.st, sim: r.sim })) wins.push(`${bits}/${hashes}`)
      }
    }
    expect(wins).toEqual(['128/2', '128/3', '128/4'].filter((w) => wins.includes(w)))
    expect(wins).toContain('128/3')
    expect(wins.every((w) => w.startsWith('128'))).toBe(true)
  })

  it('deleting: plain switches fail, counting wins', () => {
    const { st, goal } = challenge(5)
    const plain = play(st, [(s) => ({ ...s, drop: s.drop + 1 }), ask('friend')], 5)
    expect(plain.sim.metrics.wrong).toBe(1)
    expect(goal.check({ m: plain.sim.metrics, st: plain.st, sim: plain.sim })).toBe(false)
    const counting = play(st, [(s) => ({ ...s, counting: true }), (s) => ({ ...s, drop: s.drop + 1 }), ask('friend')], 5)
    expect(goal.check({ m: counting.sim.metrics, st: counting.st, sim: counting.sim })).toBe(true)
  })
})

describe('bloom filter chapters', () => {
  it('chapter 6 shows the wrong answer, then the fix', () => {
    const ch = CHAPTERS[5]
    const sim = new BloomSim()
    sim.apply(stateAt(ch, 0))
    for (let b = 1; b <= 3; b++) {
      sim.apply(stateAt(ch, b))
      for (let t = 0; t < TICKS_PER_SECOND * 6; t++) sim.step()
    }
    expect(sim.metrics.wrong).toBe(1)
    for (let b = 4; b <= 5; b++) {
      sim.apply(stateAt(ch, b))
      for (let t = 0; t < TICKS_PER_SECOND * 6; t++) sim.step()
    }
    expect(sim.metrics).toMatchObject({ wrong: 0, deleted: 1, answered: 1, trips: 1 })
  })

  it('chapter 3 lookalike beat wastes a trip but stays right', () => {
    const ch = CHAPTERS[2]
    const sim = new BloomSim()
    sim.apply(stateAt(ch, 0))
    sim.apply(stateAt(ch, 1))
    for (let t = 0; t < TICKS_PER_SECOND * 6; t++) sim.step()
    expect(sim.metrics).toMatchObject({ trips: 1, wasted: 1, wrong: 0 })
  })

  it('chapter 1 piles up lookups at the database without a filter', () => {
    const sim = new BloomSim()
    sim.apply(stateAt(CHAPTERS[0], 3))
    for (let t = 0; t < TICKS_PER_SECOND * 20; t++) sim.step()
    expect(sim.metrics.queue).toBeGreaterThan(8)
  })
})
