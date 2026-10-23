import { describe, expect, it } from 'vitest'
import { CHAPTERS as CACHING } from './caching/chapters'
import { CHAPTERS as LOAD_BALANCING } from './load-balancing/chapters'

const topics = { 'load balancing': LOAD_BALANCING, caching: CACHING }

describe.each(Object.entries(topics))('%s predictions', (_, chapters) => {
  const predictions = chapters.flatMap((c) => c.beats.flatMap((b) => (b.predict ? [{ chapter: c.title, ...b.predict }] : [])))

  it('asks at least one question in every chapter with something to predict', () => {
    // Every chapter except the reference-only ones ends up with a question.
    expect(predictions.length).toBeGreaterThanOrEqual(chapters.length - 1)
  })

  it.each(predictions.map((p) => [p.question, p] as const))('is well formed: %s', (_q, p) => {
    expect(p.options.length).toBeGreaterThanOrEqual(2)
    expect(new Set(p.options).size).toBe(p.options.length)
    expect(p.answer).toBeGreaterThanOrEqual(0)
    expect(p.answer).toBeLessThan(p.options.length)
    expect(p.explain.length).toBeGreaterThan(10)
  })
})
