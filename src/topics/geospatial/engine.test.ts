import { describe, expect, it } from 'vitest'
import { cellName, GeoSim, LEAF_CAP, MS_PER_ROW } from './engine'
import type { GeoState } from './types'
import { TICKS_PER_SECOND } from './world'

const BASE: GeoState = { ask: 0, round: 0, method: 'scan', drivers: 400, city: 'even', res: 8, neighbours: false, widen: false, edge: false, rate: 0 }

const run = (over: Partial<GeoState>) => {
  const sim = new GeoSim()
  sim.apply({ ...BASE, ...over })
  return sim
}

describe('geospatial engine', () => {
  it('a scan checks every car and is always right', () => {
    const sim = run({ drivers: 4000, ask: 5 })
    expect(sim.metrics.checked).toBe(4000)
    expect(sim.metrics.ms).toBeCloseTo(4000 * MS_PER_ROW)
    expect(sim.metrics.misses).toBe(0)
  })

  it('a grid reads far fewer cars, and smaller cells read fewer', () => {
    const big = run({ method: 'grid', res: 4, drivers: 4000, ask: 5 }).metrics.avgChecked
    const mid = run({ method: 'grid', res: 8, drivers: 4000, ask: 5 }).metrics.avgChecked
    const small = run({ method: 'grid', res: 16, drivers: 4000, ask: 5 }).metrics.avgChecked
    expect(big).toBeLessThan(4000 / 4)
    expect(mid).toBeLessThan(big)
    expect(small).toBeLessThan(mid)
  })

  it('riders at a cell edge get a worse car from their own cell, and the right one with neighbours', () => {
    const alone = run({ method: 'grid', edge: true, ask: 6 })
    expect(alone.metrics.misses).toBe(6)
    const around = run({ method: 'grid', edge: true, neighbours: true, ask: 6 })
    expect(around.metrics.misses).toBe(0)
    expect(around.metrics.cells).toBeGreaterThan(1)
  })

  it('an empty cell finds nothing until a letter is dropped', () => {
    const quiet = { method: 'geohash' as const, drivers: 40, res: 16, ask: 4 }
    expect(run(quiet).last!.outcome).toBe('none')
    const wide = run({ ...quiet, widen: true, neighbours: true })
    expect(wide.metrics.misses).toBe(0)
  })

  it('a geohash name starts with the name of the bigger cell around it', () => {
    expect(cellName(0.3, 0.8, 16)).toHaveLength(4)
    expect(cellName(0.3, 0.8, 16).startsWith(cellName(0.3, 0.8, 4))).toBe(true)
    expect(cellName(0.3, 0.8, 16).startsWith(cellName(0.3, 0.8, 8))).toBe(true)
  })

  it('a quadtree splits crowded boxes and is always right with little work', () => {
    const sim = run({ method: 'quadtree', drivers: 4000, city: 'downtown', ask: 10 })
    expect(sim.metrics.misses).toBe(0)
    expect(sim.metrics.avgChecked).toBeLessThan(60)
    expect(sim.leaves.every((l) => l.ids.length <= LEAF_CAP)).toBe(true)
    expect(sim.leaves.reduce((n, l) => n + l.ids.length, 0)).toBe(4000)
  })

  it('a busy downtown makes a grid read a lot and a quadtree read little', () => {
    const grid = run({ method: 'grid', res: 16, neighbours: true, drivers: 4000, city: 'downtown', ask: 8 }).metrics.avgChecked
    const tree = run({ method: 'quadtree', drivers: 4000, city: 'downtown', ask: 8 }).metrics.avgChecked
    expect(grid).toBeGreaterThan(10 * tree)
  })

  it('a changed setting replays the same riders', () => {
    const sim = run({ method: 'grid', drivers: 4000, ask: 3 })
    const rider = sim.last!.rider
    sim.apply({ ...BASE, method: 'quadtree', drivers: 4000, ask: 3 })
    expect(sim.last!.rider).toEqual(rider)
    expect(sim.metrics.lookups).toBe(3)
  })

  it('counts the asks that come by themselves, and the cars read each second', () => {
    const sim = run({ method: 'scan', drivers: 400, rate: 10 })
    for (let t = 0; t < TICKS_PER_SECOND * 3; t++) sim.step()
    expect(sim.metrics.lookups).toBe(30)
    expect(sim.metrics.load).toBeCloseTo(10 * 400, -1)
  })
})
