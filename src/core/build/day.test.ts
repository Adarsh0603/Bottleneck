import { describe, expect, it } from 'vitest'
import { freshRng, jitter, seeded } from './day'
import { startRun } from './run'
import type { BuildTask } from './types'

describe('a changing day', () => {
  it('repeats for the same seed and differs for another', () => {
    expect(seeded(5)()).toBe(seeded(5)())
    expect(seeded(5)()).not.toBe(seeded(6)())
  })
  it('keeps jitter between the base and base + spread', () => {
    const rng = seeded(1)
    for (let i = 0; i < 200; i++) {
      const v = jitter(rng, 1, 0.2)
      expect(v).toBeGreaterThanOrEqual(1)
      expect(v).toBeLessThan(1.2)
    }
  })
  it('hands a fresh stream to a task that wants a new day, and none to one that does not', () => {
    const seen: (undefined | (() => number))[] = []
    const task = { freshDay: true, assemble: (_p: unknown, _s: unknown, rng?: () => number) => (seen.push(rng), {}) } as unknown as BuildTask
    startRun(task, {}, {})
    startRun({ ...task, freshDay: false }, {}, {})
    expect(typeof seen[0]).toBe('function')
    expect(seen[1]).toBeUndefined()
    expect(freshRng()()).toBeLessThan(1)
  })
})
