import { describe, expect, it } from 'vitest'
import { formatRoute, parseRoute } from './router'

describe('parseRoute', () => {
  it('reads home', () => {
    expect(parseRoute('')).toEqual({ page: 'home' })
    expect(parseRoute('#/')).toEqual({ page: 'home' })
  })

  it('reads topic, chapter and step, counting from 1 in the URL', () => {
    expect(parseRoute('#/load-balancing')).toEqual({ page: 'topic', topic: 'load-balancing', chapter: 0, step: 0 })
    expect(parseRoute('#/load-balancing/3/2')).toEqual({ page: 'topic', topic: 'load-balancing', chapter: 2, step: 1 })
  })

  it('treats nonsense numbers as the first chapter or step', () => {
    expect(parseRoute('#/lb/zero/-4')).toEqual({ page: 'topic', topic: 'lb', chapter: 0, step: 0 })
  })
})

describe('formatRoute', () => {
  it('round-trips, leaving out step 1', () => {
    expect(formatRoute({ page: 'topic', topic: 'lb', chapter: 2, step: 0 })).toBe('#/lb/3')
    expect(formatRoute({ page: 'topic', topic: 'lb', chapter: 2, step: 3 })).toBe('#/lb/3/4')
    expect(parseRoute(formatRoute({ page: 'topic', topic: 'lb', chapter: 4, step: 1 }))).toEqual({
      page: 'topic',
      topic: 'lb',
      chapter: 4,
      step: 1,
    })
    expect(formatRoute({ page: 'home' })).toBe('#/')
  })
})
