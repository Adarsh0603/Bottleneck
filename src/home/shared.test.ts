import { describe, expect, it } from 'vitest'
import { withStep, type Progress } from '../core/progress'
import { TOPICS } from '../topics/registry'
import { statusOf } from './shared'

const lb = TOPICS.find((t) => t.id === 'load-balancing')!
const caching = TOPICS.find((t) => t.id === 'caching')!

// Mark every chapter of a topic done.
const finish = (p: Progress, topic: typeof lb) =>
  topic.chapters!.reduce((acc, _, i) => withStep(acc, topic.id, i, 0, true, 1), p)

describe('completion helpers', () => {
  it('knows each built topic’s challenges', () => {
    expect(lb.challenges).toEqual(['2:0', '3:3', '4:3', '5:3', '7:0'])
    expect(caching.challenges?.length).toBe(4)
  })

  it('a topic is complete only when every chapter is done', () => {
    let p = finish({}, lb)
    expect(statusOf(p, lb)).toBe('done')
    p = withStep({}, lb.id, 0, 0, true, 1)
    expect(statusOf(p, lb)).toBe('started')
  })
})
