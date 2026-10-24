import { describe, expect, it } from 'vitest'
import { splitLead } from './splitLead'

describe('splitLead', () => {
  it('splits at the first sentence', () => {
    expect(splitLead('Add a cache when reads dominate. Say how entries leave: a TTL or LRU.')).toEqual({
      lead: 'Add a cache when reads dominate.',
      rest: 'Say how entries leave: a TTL or LRU.',
    })
  })

  it('keeps a single sentence whole', () => {
    expect(splitLead('Only one sentence here.')).toEqual({ lead: 'Only one sentence here.', rest: '' })
  })

  it('does not split after an abbreviation', () => {
    const text = 'Use a shared cache, e.g. Redis, for hot data. It is faster.'
    expect(splitLead(text)).toEqual({ lead: 'Use a shared cache, e.g. Redis, for hot data.', rest: 'It is faster.' })
  })

  it('does not split on a lowercase continuation', () => {
    expect(splitLead('Quorums need R + W > N. Then reads see the latest write.').lead).toBe('Quorums need R + W > N.')
  })

  it('splits after a closing quote', () => {
    expect(splitLead('The primary says “saved”. No lost writes.')).toEqual({ lead: 'The primary says “saved”.', rest: 'No lost writes.' })
  })

  it('handles empty text', () => {
    expect(splitLead('')).toEqual({ lead: '', rest: '' })
  })
})
