import { describe, expect, it } from 'vitest'
import { continueTarget, parse, topicProgress, withSolved, withStep } from './progress'

describe('withStep', () => {
  it('remembers where the learner is', () => {
    const p = withStep({}, 'lb', 2, 1, false, 100)
    expect(topicProgress(p, 'lb')).toEqual({ done: [], solved: [], last: { chapter: 2, step: 1 }, updatedAt: 100 })
  })

  it('marks a chapter done on its last step, once, in order', () => {
    let p = withStep({}, 'lb', 3, 4, true, 1)
    p = withStep(p, 'lb', 0, 3, true, 2)
    p = withStep(p, 'lb', 3, 4, true, 3)
    expect(topicProgress(p, 'lb').done).toEqual([0, 3])
  })

  it('returns the same object when nothing changed, so nothing is saved', () => {
    const p = withStep({}, 'lb', 1, 1, false, 1)
    expect(withStep(p, 'lb', 1, 1, false, 2)).toBe(p)
  })
})

describe('withSolved', () => {
  it('records each challenge once', () => {
    let p = withSolved({}, 'lb', 2, 0, 1)
    p = withSolved(p, 'lb', 2, 0, 2)
    expect(topicProgress(p, 'lb').solved).toEqual(['2:0'])
  })
})

describe('continueTarget', () => {
  it('picks the most recent topic that is not finished', () => {
    let p = withStep({}, 'a', 1, 0, false, 10)
    p = withStep(p, 'b', 0, 2, false, 20)
    expect(continueTarget(p, { a: 3, b: 3 })).toMatchObject({ topic: 'b', chapter: 0, step: 2 })
  })

  it('skips finished topics and topics that no longer exist', () => {
    let p = withStep({}, 'a', 0, 1, true, 30)
    p = withStep(p, 'gone', 0, 0, false, 40)
    expect(continueTarget(p, { a: 1 })).toBeUndefined()
  })
})

describe('parse', () => {
  it('ignores missing, broken or unexpected data', () => {
    expect(parse(null)).toEqual({})
    expect(parse('not json')).toEqual({})
    expect(parse('42')).toEqual({})
    expect(parse('{"lb": {"done": "nope"}}')).toEqual({})
  })

  it('keeps valid entries and drops bad fields', () => {
    const raw = JSON.stringify({ lb: { done: [0, 'x'], solved: ['2:0'], last: { chapter: 1 }, updatedAt: 5 } })
    expect(parse(raw)).toEqual({ lb: { done: [0], solved: ['2:0'], last: undefined, updatedAt: 5 } })
  })
})
