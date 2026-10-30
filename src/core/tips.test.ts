import { describe, expect, it } from 'vitest'
import { mergeTips, parse } from './tips'

describe('tips', () => {
  it('ignores anything that is not a list of names', () => {
    expect(parse(null)).toEqual([])
    expect(parse('{"a":1}')).toEqual([])
    expect(parse('nope')).toEqual([])
    expect(parse('["start",3,"start","drag"]')).toEqual(['start', 'drag'])
  })
  it('keeps a tip seen on either device', () => {
    expect(mergeTips(['start'], ['drag', 'start']).sort()).toEqual(['drag', 'start'])
  })
})
