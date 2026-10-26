import { describe, expect, it } from 'vitest'
import { FlowSim } from '../flow/engine'
import { fit } from './placement'
import { mergeBuilds, parse } from './saved'
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
    { id: 'a', x: 0, z: 0, accepts: ['server'] },
    { id: 'b', x: 1, z: 0, accepts: ['server'] },
  ],
  toolbox: [{ kind: 'server', count: 1 }],
  assemble: () => new FlowSim(),
  check: () => true,
}

describe('saved builds', () => {
  it('reads a good save back', () => {
    const raw = JSON.stringify({ 't:1': { placed: { a: 'server' }, settings: { size: 3 } } })
    expect(parse(raw)).toEqual({ 't:1': { placed: { a: 'server' }, settings: { size: 3 } } })
  })

  it('ignores junk instead of crashing', () => {
    expect(parse(null)).toEqual({})
    expect(parse('not json')).toEqual({})
    expect(parse('[1,2]')).toEqual({})
    expect(parse(JSON.stringify({ x: 5, y: { placed: { a: 'toaster' }, settings: { n: 'x' } } }))).toEqual({
      y: { placed: {}, settings: {} },
    })
  })

  it('cuts a save down to what the task still allows', () => {
    const saved = { placed: { a: 'server', b: 'server', gone: 'server' } as const, settings: {} }
    expect(fit(task, saved).placed).toEqual({ a: 'server' })
    expect(fit(task, undefined)).toEqual({ placed: {}, settings: {} })
  })
})

describe('mergeBuilds', () => {
  it('keeps every build and the newer copy of a shared one', () => {
    const old = { placed: { a: 'server' as const }, settings: {}, updatedAt: 1 }
    const fresh = { placed: { a: 'cache' as const }, settings: {}, updatedAt: 2 }
    const m = mergeBuilds({ x: old, only: old }, { x: fresh, other: old })
    expect(m.x).toBe(fresh)
    expect(Object.keys(m).sort()).toEqual(['only', 'other', 'x'])
  })
})
