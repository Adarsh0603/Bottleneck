import { describe, expect, it } from 'vitest'
import { withSolved, withStep, type Progress } from '../core/progress'
import { TOPICS } from '../topics/registry'
import { builtTopics, nextAfter, solvedCount, statusOf } from './shared'

const lb = TOPICS.find((t) => t.id === 'load-balancing')!
const caching = TOPICS.find((t) => t.id === 'caching')!

// Mark every chapter of a topic done.
const finish = (p: Progress, topic: typeof lb) =>
  topic.chapters!.reduce((acc, _, i) => withStep(acc, topic.id, i, 0, true, 1), p)

describe('completion helpers', () => {
  it('knows each built topic’s challenges', () => {
    expect(lb.challenges).toEqual(['2:0', '3:3', '4:3', '5:3'])
    expect(caching.challenges?.length).toBe(2)
  })

  it('a topic is complete only when every chapter is done', () => {
    let p = finish({}, lb)
    expect(statusOf(p, lb)).toBe('done')
    p = withStep({}, lb.id, 0, 0, true, 1)
    expect(statusOf(p, lb)).toBe('started')
  })

  it('counts only this topic’s real challenges as solved', () => {
    let p = withSolved({}, lb.id, 2, 0, 1)
    p = withSolved(p, lb.id, 9, 9, 2) // not a challenge
    expect(solvedCount(p, lb)).toBe(1)
  })

  it('suggests the next unfinished topic after the one just completed', () => {
    const p = finish({}, lb)
    expect(nextAfter(p, lb)?.id).toBe(builtTopics[1].id)
    expect(nextAfter(finish(p, caching), caching)).toBeUndefined()
  })
})
