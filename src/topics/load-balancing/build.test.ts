import { describe, expect, it } from 'vitest'
import { Running, TICKS_PER_SECOND } from '../../core/build/run'
import type { Placement } from '../../core/build/types'
import { BLACK_FRIDAY } from './build'

// Runs a build for up to a minute and reports whether the goal would be
// reached, exactly as the builder checks it.
function wins(placed: Placement, seed: number) {
  let x = seed
  const run = new Running(BLACK_FRIDAY.assemble(placed, () => (x = (x * 16807) % 2147483647) / 2147483647))
  let streak = 0
  for (let t = 0; t < TICKS_PER_SECOND * 60; t++) {
    run.step()
    streak = BLACK_FRIDAY.check(run.metrics(), placed) ? streak + 1 : 0
    if (streak >= BLACK_FRIDAY.holdSeconds * TICKS_PER_SECOND) return true
  }
  return false
}

const seeds = [1, 2, 3, 4, 5]
const always = (p: Placement) => seeds.every((s) => wins(p, s))
const never = (p: Placement) => seeds.every((s) => !wins(p, s))
const servers = (n: number): Placement => Object.fromEntries(Array.from({ length: n }, (_, i) => [`back-${i}`, 'server']))

describe('Black Friday build', () => {
  it('nothing built: everything is dropped', () => {
    expect(never({})).toBe(true)
  })

  it('a lone server in front is not enough', () => {
    expect(never({ front: 'server' })).toBe(true)
  })

  it('servers behind a server do nothing: users only reach the front one', () => {
    expect(never({ front: 'server', ...servers(5) })).toBe(true)
  })

  it('a load balancer needs at least four servers behind it', () => {
    expect(never({ front: 'balancer', ...servers(3) })).toBe(true)
    expect(always({ front: 'balancer', ...servers(4) })).toBe(true)
    expect(always({ front: 'balancer', ...servers(5) })).toBe(true)
  })
})
