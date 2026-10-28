import { describe, expect, it } from 'vitest'
import { stateAt } from '../../core/chapters'
import { CHAPTERS } from './chapters'
import { GeoSim } from './engine'
import type { GeoState } from './types'
import { TICKS_PER_SECOND } from './world'

// The state at a chapter's practice challenge, with its checker.
function challenge(chapter: number) {
  const ch = CHAPTERS[chapter]
  const beat = ch.beats.findIndex((b) => b.challenge)
  return { st: stateAt(ch, beat), goal: ch.beats[beat].challenge! }
}

function play(st: GeoState, change: Partial<GeoState> = {}, seconds = 0) {
  const sim = new GeoSim()
  const cur = { ...st, ...change }
  sim.apply(cur)
  for (let t = 0; t < TICKS_PER_SECOND * seconds; t++) sim.step()
  return { sim, st: cur }
}

const won = (r: { sim: GeoSim; st: GeoState }, goal: ReturnType<typeof challenge>['goal']) => goal.check({ m: r.sim.metrics, st: r.st, sim: r.sim })

describe('geospatial challenges', () => {
  it('the nearest car: three asks', () => {
    const { st, goal } = challenge(0)
    expect(st.ask).toBe(0)
    expect(won(play(st, { ask: 2 }), goal)).toBe(false)
    expect(won(play(st, { ask: 3 }), goal)).toBe(true)
  })

  it('check every car: only a big city is slow enough', () => {
    const { st, goal } = challenge(1)
    expect(won(play(st, { ask: 1 }), goal)).toBe(false)
    expect(won(play(st, { ask: 1, drivers: 40 }), goal)).toBe(false)
    expect(won(play(st, { ask: 1, drivers: 4000 }), goal)).toBe(true)
  })

  it('cut the map into cells: only small cells check under 30 cars', () => {
    const { st, goal } = challenge(2)
    expect(st.res).toBe(4)
    expect(won(play(st, { ask: 1 }), goal)).toBe(false)
    expect(won(play(st, { ask: 1, res: 8 }), goal)).toBe(false)
    expect(won(play(st, { ask: 1, res: 16 }), goal)).toBe(true)
    expect(won(play(st, { ask: 1, method: 'scan' }), goal)).toBe(false)
  })

  it('the edge of a cell: only reading the neighbours gets every car right', () => {
    const { st, goal } = challenge(3)
    expect(st.neighbours).toBe(false)
    expect(won(play(st, { ask: 3 }), goal)).toBe(false)
    expect(won(play(st, { ask: 3, neighbours: true }), goal)).toBe(true)
    expect(won(play(st, { ask: 2, neighbours: true }), goal)).toBe(false)
  })

  it('names for places: widening with neighbours, or bigger cells, are right in a quiet town', () => {
    const { st, goal } = challenge(4)
    expect(st.widen).toBe(false)
    expect(won(play(st, { ask: 6 }), goal)).toBe(false)
    expect(won(play(st, { ask: 6, neighbours: true }), goal)).toBe(false)
    expect(won(play(st, { ask: 6, widen: true }), goal)).toBe(false)
    expect(won(play(st, { ask: 6, widen: true, neighbours: true }), goal)).toBe(true)
    expect(won(play(st, { ask: 6, res: 4, neighbours: true }), goal)).toBe(true)
  })

  it('a busy downtown: only the quadtree is right and light', () => {
    const { st, goal } = challenge(5)
    expect(st.method).toBe('grid')
    expect(won(play(st, { ask: 5 }), goal)).toBe(false)
    expect(won(play(st, { ask: 5, neighbours: false }), goal)).toBe(false)
    expect(won(play(st, { ask: 5, res: 8, neighbours: false }), goal)).toBe(false)
    expect(won(play(st, { ask: 5, method: 'quadtree' }), goal)).toBe(true)
    expect(won(play(st, { ask: 4, method: 'quadtree' }), goal)).toBe(false)
  })

  it('which one to use: ten asks a second, only the quadtree reads little and is right', () => {
    const { st, goal } = challenge(6)
    expect(st.rate).toBe(10)
    const tryMethod = (change: Partial<GeoState>) => won(play(st, change, 4), goal)
    expect(tryMethod({})).toBe(false)
    expect(tryMethod({ method: 'grid', res: 16, neighbours: true })).toBe(false)
    expect(tryMethod({ method: 'grid', res: 16, neighbours: false })).toBe(false)
    expect(tryMethod({ method: 'geohash', res: 16, neighbours: true, widen: true })).toBe(false)
    expect(tryMethod({ method: 'quadtree' })).toBe(true)
  })
})
