import { describe, expect, it } from 'vitest'
import { CHAPTERS as CACHING } from './caching/chapters'
import { CHAPTERS as LOAD_BALANCING } from './load-balancing/chapters'
import { CHAPTERS as REPLICATION } from './replication/chapters'
import { CHAPTERS as SHARDING } from './sharding/chapters'

const topics = { 'load balancing': LOAD_BALANCING, caching: CACHING, replication: REPLICATION, sharding: SHARDING }

describe.each(Object.entries(topics))('%s questions', (_, chapters) => {
  const questions = chapters.flatMap((c) => c.beats.flatMap((b) => (b.predict ? [b.predict] : [])))

  it('asks only a few, at the surprising moments', () => {
    expect(questions.length).toBeGreaterThanOrEqual(2)
    expect(questions.length).toBeLessThanOrEqual(3)
  })

  it.each(questions.map((q) => [q.question, q] as const))('is answerable by tapping the scene: %s', (_q, q) => {
    expect(q.clue.trim()).not.toBe('')
    expect(q.options.length).toBeGreaterThanOrEqual(2)
    expect(new Set(q.options.map((o) => o.label)).size).toBe(q.options.length)
    expect(q.answer).toBeGreaterThanOrEqual(0)
    expect(q.answer).toBeLessThan(q.options.length)
    for (const o of q.options) expect(o.at).toHaveLength(3)
  })
})
