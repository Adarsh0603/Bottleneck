import { describe, expect, it } from 'vitest'
import { LoadBalancerSim } from '../simulators/loadBalancer/engine'
import { TICKS_PER_SECOND } from '../simulators/loadBalancer/useSim'
import { CHAPTERS, stateAt } from './chapters'
import { syncSim } from './sync'
import type { CourseState } from './types'

// Plays a chapter's challenge for up to a minute with the given setup and
// reports whether it would be marked solved, exactly as the player checks it.
function solves(chapterTitle: string, setup: Partial<CourseState>, seed = 1) {
  const chapter = CHAPTERS.find((c) => c.title === chapterTitle)!
  const beatIdx = chapter.beats.findIndex((b) => b.challenge)
  const challenge = chapter.beats[beatIdx].challenge!
  const st = { ...stateAt(chapter, beatIdx), ...setup }

  let x = seed
  const rng = () => (x = (x * 16807) % 2147483647) / 2147483647
  const sim = new LoadBalancerSim({}, rng)
  syncSim(sim, st)

  const history: { completed: number; dropped: number }[] = []
  let streak = 0
  for (let tick = 0; tick < TICKS_PER_SECOND * 60; tick++) {
    sim.step()
    history.push({ completed: sim.stats.completed, dropped: sim.stats.dropped })
    if (history.length > TICKS_PER_SECOND * 3 + 1) history.shift()
    const completed = history[history.length - 1].completed - history[0].completed
    const dropped = history[history.length - 1].dropped - history[0].dropped
    const dropRate = completed + dropped === 0 ? 0 : (dropped / (completed + dropped)) * 100
    const m = { dropRate, avgMs: 0, p95Ms: 0, throughput: 0 }
    streak = challenge.check({ m, st, sim }) ? streak + 1 : 0
    if (streak >= challenge.holdSeconds * TICKS_PER_SECOND) return true
  }
  return false
}

const seeds = [1, 2, 3, 4, 5]
const always = (title: string, setup: Partial<CourseState>) => seeds.every((s) => solves(title, setup, s))
const never = (title: string, setup: Partial<CourseState>) => seeds.every((s) => !solves(title, setup, s))

describe('challenges reward the right fix and only the right fix', () => {
  it('scale up: a Large machine works, the Small one does not', () => {
    expect(never('Scale up', { servers: [1] })).toBe(true)
    expect(always('Scale up', { servers: [2] })).toBe(true)
  })

  it('scale out: needs the load balancer and four servers', () => {
    expect(never('Scale out', { servers: [1, 1, 1, 1, 1, 1], balancer: false })).toBe(true)
    expect(never('Scale out', { servers: [1, 1, 1], balancer: true })).toBe(true)
    expect(always('Scale out', { servers: [1, 1, 1, 1], balancer: true })).toBe(true)
  })

  it('algorithms: only a load-aware algorithm copes with the slow server', () => {
    expect(never('Algorithms', { algorithm: 'round-robin' })).toBe(true)
    expect(never('Algorithms', { algorithm: 'random' })).toBe(true)
    expect(always('Algorithms', { algorithm: 'least-connections' })).toBe(true)
  })

  it('failures: one spare server covers the crash', () => {
    expect(never('Failures', {})).toBe(true)
    expect(never('Failures', { down: [] })).toBe(true)
    expect(always('Failures', { servers: [1, 1, 1, 1] })).toBe(true)
  })
})
