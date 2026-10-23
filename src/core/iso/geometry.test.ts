import { describe, expect, it } from 'vitest'
import { frameScale, VIEW_H, VIEW_W } from './geometry'

describe('frameScale', () => {
  it('fits the whole reference area on wide screens, exactly as before', () => {
    expect(frameScale(1440, 800)).toBeCloseTo(Math.min(1440 / VIEW_W, 800 / VIEW_H))
    expect(frameScale(VIEW_W, VIEW_H)).toBeCloseTo(1)
  })

  it('makes the scene much bigger on an upright phone than plain fitting would', () => {
    const fit = Math.min(390 / VIEW_W, 700 / VIEW_H)
    const scale = frameScale(390, 700)
    expect(scale / fit).toBeGreaterThan(1.5)
    // ...while still showing more than half the reference width.
    expect(390 / scale / VIEW_W).toBeGreaterThan(0.5)
  })
})
