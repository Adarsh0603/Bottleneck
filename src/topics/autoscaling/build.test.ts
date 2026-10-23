import { describe, expect, it } from 'vitest'
import { Running } from '../../core/build/run'
import type { Placement, Settings } from '../../core/build/types'
import { FLASH_SALE } from './build'
import { TICKS_PER_SECOND } from './world'

const seeded = (seed: number) => {
  let x = seed
  return () => (x = (x * 16807) % 2147483647) / 2147483647
}
const seeds = [1, 2, 3, 4, 5]

function buildWins(placed: Placement, settings: Settings, seed: number) {
  const run = new Running(FLASH_SALE.assemble(placed, settings, seeded(seed)))
  let streak = 0
  for (let t = 0; t < TICKS_PER_SECOND * 60; t++) {
    run.step()
    streak = FLASH_SALE.check(run.metrics(), placed, settings, run.flow) ? streak + 1 : 0
    if (streak >= FLASH_SALE.holdSeconds * TICKS_PER_SECOND) return true
  }
  return false
}

const always = (placed: Placement, settings: Settings = {}) => seeds.every((s) => buildWins(placed, settings, s))
const never = (placed: Placement, settings: Settings = {}) => seeds.every((s) => !buildWins(placed, settings, s))

describe('flash sale build', () => {
  const scaled: Placement = { front: 'balancer', scaler: 'autoscaler' }

  it('needs a balancer, an autoscaler and spare servers', () => {
    expect(always(scaled, { spare: 2 })).toBe(true)
    expect(always({ ...scaled, 'back-0': 'server', 'back-1': 'server' }, { spare: 2 })).toBe(true)
  })

  it('fails without spare room, without an autoscaler, or without a balancer', () => {
    expect(never(scaled, { spare: 0 })).toBe(true)
    expect(never({ ...scaled, 'back-0': 'server', 'back-1': 'server' }, { spare: 0 })).toBe(true)
    expect(never({ front: 'balancer', 'back-0': 'server', 'back-1': 'server' })).toBe(true)
    expect(never({ front: 'server', scaler: 'autoscaler', 'back-0': 'server' }, { spare: 3 })).toBe(true)
  })

  it('launches servers on empty pads and removes them when quiet', () => {
    const run = new Running(FLASH_SALE.assemble(scaled, { spare: 2 }, seeded(1)))
    let most = 0
    // A rush, then most of the quiet after it.
    for (let t = 0; t < TICKS_PER_SECOND * 22; t++) {
      run.step()
      most = Math.max(most, run.flow.targets('front').length)
    }
    expect(most).toBeGreaterThanOrEqual(5)
    for (let t = 0; t < TICKS_PER_SECOND * 10; t++) run.step()
    expect(run.flow.targets('front').length).toBeLessThan(most)
  })
})
