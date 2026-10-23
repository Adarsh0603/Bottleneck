import { describe, expect, it } from 'vitest'
import { FlowSim } from '../flow/engine'
import { canDrop, drop, lift, remaining } from './placement'
import type { BuildTask } from './types'

const task: BuildTask = {
  title: '',
  sub: '',
  goal: '',
  win: '',
  holdSeconds: 1,
  rps: 1,
  shot: { target: [0, 0, 0], zoom: 1 },
  fixed: [],
  pads: [
    { id: 'front', x: 0, z: 0, accepts: ['balancer', 'server'] },
    { id: 'a', x: 1, z: 0, accepts: ['server'] },
    { id: 'b', x: 1, z: 1, accepts: ['server'] },
  ],
  toolbox: [
    { kind: 'balancer', count: 1 },
    { kind: 'server', count: 2 },
  ],
  assemble: () => new FlowSim(),
  check: () => true,
}

describe('placement', () => {
  it('counts what is left in the toolbox', () => {
    expect(remaining(task, {})).toEqual({ balancer: 1, server: 2 })
    expect(remaining(task, { front: 'server', a: 'server' })).toEqual({ balancer: 1, server: 0 })
  })

  it('only drops pieces on pads that accept them', () => {
    expect(canDrop(task, {}, 'a', 'balancer')).toBe(false)
    expect(canDrop(task, {}, 'front', 'balancer')).toBe(true)
    expect(drop(task, {}, 'a', 'balancer')).toEqual({})
  })

  it('runs out of a piece once all are placed', () => {
    const placed = { front: 'server', a: 'server' } as const
    expect(canDrop(task, placed, 'b', 'server')).toBe(false)
  })

  it('replacing a piece from the toolbox sends the old one back', () => {
    const next = drop(task, { front: 'server' }, 'front', 'balancer')
    expect(next).toEqual({ front: 'balancer' })
    expect(remaining(task, next)).toEqual({ balancer: 0, server: 2 })
  })

  it('moves a piece between pads, swapping when the other piece fits', () => {
    expect(drop(task, { a: 'server' }, 'b', 'server', 'a')).toEqual({ b: 'server' })
    expect(drop(task, { front: 'balancer', a: 'server' }, 'front', 'server', 'a')).toEqual({ front: 'server' })
    expect(drop(task, { front: 'server', a: 'server' }, 'front', 'server', 'a')).toEqual({ front: 'server', a: 'server' })
  })

  it('lifting a piece returns it to the toolbox', () => {
    const next = lift({ front: 'balancer', a: 'server' }, 'a')
    expect(next).toEqual({ front: 'balancer' })
    expect(remaining(task, next)).toEqual({ balancer: 0, server: 2 })
  })
})
