import { describe, expect, it } from 'vitest'
import { stateAt } from '../../core/chapters'
import { CHAPTERS } from './chapters'
import { CachingSim, TICKS_PER_SECOND } from './engine'
import type { CachingState } from './types'

// Plays a chapter's challenge for up to a minute with the given setup and
// reports whether it would be marked solved, exactly as the player checks it.
function solves(chapterTitle: string, setup: Partial<CachingState>, seed: number) {
  const chapter = CHAPTERS.find((c) => c.title === chapterTitle)!
  const beatIdx = chapter.beats.findIndex((b) => b.challenge)
  const challenge = chapter.beats[beatIdx].challenge!
  const st = { ...stateAt(chapter, beatIdx), ...setup }

  let x = seed
  const sim = new CachingSim(() => (x = (x * 16807) % 2147483647) / 2147483647)
  sim.apply(st)
  let streak = 0
  for (let tick = 0; tick < TICKS_PER_SECOND * 60; tick++) {
    sim.step()
    streak = challenge.check({ m: sim.metrics, st, sim }) ? streak + 1 : 0
    if (streak >= challenge.holdSeconds * TICKS_PER_SECOND) return true
  }
  return false
}

const seeds = [1, 2, 3, 4, 5]
const always = (title: string, setup: Partial<CachingState>) => seeds.every((s) => solves(title, setup, s))
const never = (title: string, setup: Partial<CachingState>) => seeds.every((s) => !solves(title, setup, s))

describe('caching challenges reward the right fix and only the right fix', () => {
  it('add a cache: a tiny cache is not enough, a decent one is', () => {
    expect(never('Add a cache', { capacity: 3 })).toBe(true)
    expect(never('Add a cache', { capacity: 5 })).toBe(true)
    expect(always('Add a cache', { capacity: 20 })).toBe(true)
  })

  it('freshness: a middle TTL balances stale answers against database load', () => {
    expect(never('Freshness', { ttl: 2 })).toBe(true) // fresh, but the database drowns
    expect(never('Freshness', { ttl: 20 })).toBe(true) // calm database, too stale
    expect(always('Freshness', { ttl: 5 })).toBe(true)
    expect(always('Freshness', { ttl: 6 })).toBe(true)
  })

  it('stampede: only coalescing survives with fresh data', () => {
    expect(never('Stampede', { ttl: 5, coalesce: false })).toBe(true)
    expect(never('Stampede', { ttl: 2, coalesce: false })).toBe(true)
    expect(never('Stampede', { ttl: 30, coalesce: true })).toBe(true) // fine, but too stale
    expect(always('Stampede', { ttl: 5, coalesce: true })).toBe(true)
    expect(always('Stampede', { ttl: 3, coalesce: true })).toBe(true)
  })
})
