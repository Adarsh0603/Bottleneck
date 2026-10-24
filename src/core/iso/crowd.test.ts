import { describe, expect, it } from 'vitest'
import { crowd, edge, glide } from './crowd'

describe('crowd', () => {
  it('leaves a handful of requests untouched', () => {
    expect(crowd(0)).toEqual({ scale: 1, opacity: 1 })
    expect(crowd(6)).toEqual({ scale: 1, opacity: 1 })
  })

  it('shrinks and fades smoothly as the crowd grows', () => {
    const a = crowd(15)
    const b = crowd(30)
    expect(a.scale).toBeLessThan(1)
    expect(b.scale).toBeLessThan(a.scale)
    expect(b.opacity).toBeLessThan(a.opacity)
  })

  it('never goes below the floor', () => {
    expect(crowd(500).scale).toBeCloseTo(0.55)
    expect(crowd(500).opacity).toBeCloseTo(0.55)
  })
})

describe('glide and edge', () => {
  it('glide keeps the ends and stays monotonic', () => {
    expect(glide(0)).toBe(0)
    expect(glide(1)).toBe(1)
    expect(glide(0.6)).toBeGreaterThan(glide(0.4))
    expect(glide(0.1)).toBeLessThan(0.1)
  })

  it('edge fades at both ends and is solid in the middle', () => {
    expect(edge(0)).toBe(0)
    expect(edge(1)).toBe(0)
    expect(edge(0.5)).toBe(1)
  })
})
