import { describe, expect, it } from 'vitest'
import { TOPICS } from '../topics/registry'
import { DISTRICT_HALF, DISTRICTS, LOTS } from './cityLayout'

describe('city layout', () => {
  it('gives every topic exactly one building', () => {
    expect(LOTS.map((l) => l.topic.id).sort()).toEqual(TOPICS.map((t) => t.id).sort())
  })

  it('never overlaps two buildings', () => {
    for (const a of LOTS) {
      for (const b of LOTS) {
        if (a === b) continue
        const apart = Math.abs(a.x - b.x) >= (a.size + b.size) / 2 || Math.abs(a.z - b.z) >= (a.size + b.size) / 2
        expect(apart, `${a.topic.id} overlaps ${b.topic.id}`).toBe(true)
      }
    }
  })

  it('keeps each building inside its own district', () => {
    for (const lot of LOTS) {
      const d = DISTRICTS[lot.topic.track]
      expect(Math.abs(lot.x - d.x) + lot.size / 2).toBeLessThanOrEqual(DISTRICT_HALF)
      expect(Math.abs(lot.z - d.z) + lot.size / 2).toBeLessThanOrEqual(DISTRICT_HALF)
    }
  })
})
