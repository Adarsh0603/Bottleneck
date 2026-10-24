import { describe, expect, it } from 'vitest'
import { stateAt } from '../../core/chapters'
import { CHAPTERS } from './chapters'
import { QueueSim } from './engine'
import type { QueueState } from './types'
import { TICKS_PER_SECOND } from './world'

const seeded = (seed: number) => {
  let x = seed
  return () => (x = (x * 16807) % 2147483647) / 2147483647
}
const seeds = [1, 2, 3, 4, 5]

const BASE: QueueState = { rps: 3, queued: false, workers: 3, flaky: false, retries: 0, deadLetter: false }

function run(st: QueueState, seconds: number, seed = 1, sim = new QueueSim(seeded(seed))) {
  sim.apply(st)
  for (let t = 0; t < TICKS_PER_SECOND * seconds; t++) sim.step()
  return sim
}

describe('queue system', () => {
  it('a worker finishes about two jobs a second', () => {
    const m = run({ ...BASE, rps: 20, queued: true, workers: 1 }, 20).metrics
    expect(m.doneRate).toBeGreaterThan(1.8)
    expect(m.doneRate).toBeLessThan(2.2)
  })

  it('without a queue a spike is turned away, and with one it is not', () => {
    expect(run({ ...BASE, rps: 12, workers: 4 }, 20).metrics.errorRate).toBeGreaterThan(5)
    expect(run({ ...BASE, rps: 12, workers: 4, queued: true }, 20).metrics.errorRate).toBe(0)
  })

  it('the queue answers the user at once; without one they wait for the job', () => {
    expect(run({ ...BASE, queued: true }, 20).metrics.responseSeconds).toBeLessThan(0.5)
    expect(run({ ...BASE }, 20).metrics.responseSeconds).toBeGreaterThan(1)
  })

  it('a queue only delays the problem: too few workers fill it and jobs are turned away', () => {
    const sim = run({ ...BASE, rps: 10, queued: true, workers: 2 }, 40)
    expect(sim.metrics.backlog).toBeGreaterThan(50)
    expect(sim.metrics.errorRate).toBeGreaterThan(10)
  })

  it('enough workers drain the backlog', () => {
    const sim = run({ ...BASE, rps: 10, queued: true, workers: 2 }, 10)
    expect(sim.metrics.backlog).toBeGreaterThan(20)
    run({ ...BASE, rps: 10, queued: true, workers: 6 }, 30, 1, sim)
    expect(sim.metrics.backlog).toBeLessThan(3)
  })

  it('failed jobs are lost with no retries and no dead-letter box', () => {
    const sim = run({ ...BASE, rps: 6, queued: true, workers: 4, flaky: true }, 30)
    expect(sim.lost).toBeGreaterThan(10)
  })

  it('retries rescue jobs that hiccup; the bad ones are parked in the dead-letter box', () => {
    const sim = run({ ...BASE, rps: 6, queued: true, workers: 4, flaky: true, retries: 2, deadLetter: true }, 40)
    expect(sim.lost).toBe(0)
    expect(sim.stuck).toBe(0)
    expect(sim.parked).toBeGreaterThan(5)
  })

  it('too few retries park jobs that would have worked', () => {
    const sim = run({ ...BASE, rps: 6, queued: true, workers: 4, flaky: true, retries: 1, deadLetter: true }, 40)
    expect(sim.stuck).toBeGreaterThan(0)
  })
})

// Each challenge is solved by the intended settings only. `warm` plays the
// chapter's earlier state first, as the learner would have seen it.
function solves(title: string, over: Partial<QueueState>, seed: number, warm = 0) {
  const chapter = CHAPTERS.find((c) => c.title === title)!
  const idx = chapter.beats.findIndex((b) => b.challenge)
  const challenge = chapter.beats[idx].challenge!
  const before = stateAt(chapter, 0)
  const st = { ...stateAt(chapter, idx), ...over }
  const sim = new QueueSim(seeded(seed))
  sim.apply(before)
  for (let t = 0; t < TICKS_PER_SECOND * warm; t++) sim.step()
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
  it('Add a queue is solved only by the queue', () => {
    expect(seeds.every((s) => solves('Add a queue', { queued: true }, s))).toBe(true)
    expect(seeds.every((s) => !solves('Add a queue', { queued: false }, s))).toBe(true)
  })

  it('The backlog is solved only by 5 or more workers', () => {
    for (const workers of [5, 6]) expect(seeds.every((s) => solves('The backlog', { workers }, s, 10))).toBe(true)
    for (const workers of [2, 3, 4]) expect(seeds.every((s) => !solves('The backlog', { workers }, s, 10))).toBe(true)
  })

  it('When jobs fail is solved only by 2 or more retries and a dead-letter box', () => {
    for (const retries of [2, 3]) expect(seeds.every((s) => solves('When jobs fail', { retries, deadLetter: true }, s, 20))).toBe(true)
    for (const retries of [0, 1]) expect(seeds.every((s) => !solves('When jobs fail', { retries, deadLetter: true }, s, 20))).toBe(true)
    for (const retries of [0, 3]) expect(seeds.every((s) => !solves('When jobs fail', { retries, deadLetter: false }, s, 20))).toBe(true)
  })
})
