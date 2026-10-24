import { describe, expect, it } from 'vitest'
import { stateAt } from '../../core/chapters'
import { Running } from '../../core/build/run'
import type { Placement } from '../../core/build/types'
import { GO_GLOBAL } from './build'
import { CHAPTERS } from './chapters'
import { CdnSim } from './engine'
import type { CdnState } from './types'
import { TICKS_PER_SECOND } from './world'

const seeded = (seed: number) => {
  let x = seed
  return () => (x = (x * 16807) % 2147483647) / 2147483647
}
const seeds = [1, 2, 3, 4, 5]

describe('cdn system', () => {
  it('far regions are slow without edges, and an edge fixes its region', () => {
    const sim = new CdnSim(seeded(1))
    sim.apply({ rps: 4, edges: { us: false, eu: false, asia: false }, purge: 0 })
    for (let t = 0; t < TICKS_PER_SECOND * 30; t++) sim.step()
    const before = sim.metrics.latency
    expect(before.us).toBeLessThan(before.eu)
    expect(before.eu).toBeLessThan(before.asia)

    sim.apply({ rps: 4, edges: { us: false, eu: false, asia: true }, purge: 0 })
    for (let t = 0; t < TICKS_PER_SECOND * 30; t++) sim.step()
    expect(sim.metrics.latency.asia).toBeLessThan(before.asia / 2)
  })

  it('a purge empties every edge', () => {
    const sim = new CdnSim(seeded(2))
    sim.apply({ rps: 4, edges: { us: true, eu: true, asia: true }, purge: 0 })
    for (let t = 0; t < TICKS_PER_SECOND * 20; t++) sim.step()
    expect(sim.edges.asia.entries.size).toBeGreaterThan(0)
    sim.apply({ rps: 4, edges: { us: true, eu: true, asia: true }, purge: 1 })
    expect(Object.values(sim.edges).every((e) => e.entries.size === 0)).toBe(true)
  })
})

// The edge challenge, run exactly as the player checks it.
function solvesChallenge(edges: CdnState['edges'], seed: number) {
  const chapter = CHAPTERS.find((c) => c.title === 'Edge servers')!
  const beatIdx = chapter.beats.findIndex((b) => b.challenge)
  const challenge = chapter.beats[beatIdx].challenge!
  const st = { ...stateAt(chapter, beatIdx), edges }
  const sim = new CdnSim(seeded(seed))
  sim.apply(st)
  let streak = 0
  for (let t = 0; t < TICKS_PER_SECOND * 60; t++) {
    sim.step()
    streak = challenge.check({ m: sim.metrics, st, sim }) ? streak + 1 : 0
    if (streak >= challenge.holdSeconds * TICKS_PER_SECOND) return true
  }
  return false
}

describe('edge challenge', () => {
  it('needs edges in Europe and Asia, and only those', () => {
    const never = (e: CdnState['edges']) => seeds.every((s) => !solvesChallenge(e, s))
    const always = (e: CdnState['edges']) => seeds.every((s) => solvesChallenge(e, s))
    expect(never({ us: false, eu: false, asia: false })).toBe(true)
    expect(never({ us: true, eu: false, asia: true })).toBe(true)
    expect(never({ us: true, eu: true, asia: true })).toBe(true) // over budget
    expect(always({ us: false, eu: true, asia: true })).toBe(true)
  })
})

function buildWins(placed: Placement, seed: number) {
  const run = new Running(GO_GLOBAL.assemble(placed, {}, seeded(seed)))
  let streak = 0
  for (let t = 0; t < TICKS_PER_SECOND * 60; t++) {
    run.step()
    streak = GO_GLOBAL.check(run.metrics(), placed, {}, run.flow) ? streak + 1 : 0
    if (streak >= GO_GLOBAL.holdSeconds * TICKS_PER_SECOND) return true
  }
  return false
}

describe('go global build', () => {
  const edge = (...regions: string[]): Placement => Object.fromEntries(regions.map((r) => [`edge-${r}`, 'cache' as const]))
  it('needs edge caches in the US and Asia', () => {
    expect(seeds.every((s) => buildWins(edge('us', 'asia'), s))).toBe(true)
    expect(seeds.every((s) => !buildWins({}, s))).toBe(true)
  })

  it('an edge in Europe is wasted: its visitors never ask for the same page twice', () => {
    expect(seeds.every((s) => !buildWins(edge('eu', 'asia'), s))).toBe(true)
    expect(seeds.every((s) => !buildWins(edge('eu', 'us'), s))).toBe(true)
  })

  it('a server is just a hop', () => {
    expect(seeds.every((s) => !buildWins({ ...edge('us'), 'edge-asia': 'server' }, s))).toBe(true)
  })
})

describe('go global problems', () => {
  const state = (placed: Placement, seconds: number) => {
    const run = new Running(GO_GLOBAL.assemble(placed, {}, seeded(1)))
    for (let t = 0; t < TICKS_PER_SECOND * seconds; t++) run.step()
    return GO_GLOBAL.problem!(run.metrics(), placed, {}, run.flow)
  }
  it('explains a wasted edge in Europe, but stays quiet about a working build', () => {
    expect(state({ 'edge-eu': 'cache' }, 20)).toMatch(/Europe/)
    expect(state({ 'edge-us': 'cache', 'edge-asia': 'cache' }, 20)).toBeNull()
  })
  it('explains a plain server', () => {
    expect(state({ 'edge-us': 'server' }, 20)).toMatch(/plain server/)
  })
})
