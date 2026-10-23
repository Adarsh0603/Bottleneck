import { describe, expect, it } from 'vitest'
import { shotAt, stateAt, stateBefore } from './chapters'
import type { Chapter, Shot } from './types'

interface St {
  a: number
  b: string
}

const near: Shot = { target: [1, 0, 0], zoom: 2 }
const far: Shot = { target: [0, 0, 0], zoom: 1 }

const chapter: Chapter<St, { set?: Partial<St>; shot?: Shot }> = {
  title: 'Test',
  level: 'Beginner',
  initial: { a: 0, b: 'start' },
  beats: [{ shot: far }, { set: { a: 1 } }, { set: { b: 'changed' }, shot: near }, { set: { a: 3 } }],
}

describe('stateAt', () => {
  it('applies every beat’s changes up to and including the given beat', () => {
    expect(stateAt(chapter, 0)).toEqual({ a: 0, b: 'start' })
    expect(stateAt(chapter, 2)).toEqual({ a: 1, b: 'changed' })
    expect(stateAt(chapter, 3)).toEqual({ a: 3, b: 'changed' })
  })

  it('does not modify the chapter’s starting state', () => {
    stateAt(chapter, 3)
    expect(chapter.initial).toEqual({ a: 0, b: 'start' })
  })
})

describe('stateBefore', () => {
  it('is the previous beat’s state, or the starting state for the first beat', () => {
    expect(stateBefore(chapter, 0)).toEqual({ a: 0, b: 'start' })
    expect(stateBefore(chapter, 3)).toEqual({ a: 1, b: 'changed' })
  })
})

describe('shotAt', () => {
  it('keeps the last shot until a beat sets a new one', () => {
    expect(shotAt(chapter, 1)).toBe(far)
    expect(shotAt(chapter, 3)).toBe(near)
  })
})
