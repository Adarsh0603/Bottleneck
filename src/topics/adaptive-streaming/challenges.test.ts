import { describe, expect, it } from 'vitest'
import { stateAt } from '../../core/chapters'
import { CHAPTERS } from './chapters'
import { CLIP, StreamSim } from './engine'
import type { StreamState } from './types'

// The state at a chapter's practice challenge, with its checker.
function challenge(chapter: number) {
  const ch = CHAPTERS[chapter]
  const beat = ch.beats.findIndex((b) => b.challenge)
  return { st: stateAt(ch, beat), goal: ch.beats[beat].challenge! }
}

// Watch the clip to the end with some settings changed, then ask the checker.
function won(chapter: number, over: Partial<StreamState> = {}) {
  const { st, goal } = challenge(chapter)
  const cur = { ...st, ...over }
  const sim = new StreamSim()
  sim.apply(cur)
  for (let i = 0; i < 20 * CLIP && !sim.metrics.done; i++) sim.step()
  return goal.check({ m: sim.metrics, st: cur, sim })
}

describe('adaptive streaming challenges', () => {
  it('the spinner: only the fast connection plays 1080p through', () => {
    expect(won(0)).toBe(false)
    expect(won(0, { net: 'dip' })).toBe(false)
    expect(won(0, { net: 'slow' })).toBe(false)
    expect(won(0, { net: 'fast' })).toBe(true)
  })

  it('small pieces: only a low quality gets through the drop', () => {
    expect(won(1)).toBe(false)
    expect(won(1, { rung: 2 })).toBe(false)
    expect(won(1, { rung: 1 })).toBe(true)
    expect(won(1, { rung: 0 })).toBe(true)
  })

  it('a ladder of qualities: wins as it stands', () => {
    expect(won(2)).toBe(true)
  })

  it('speed or buffer: only the buffer rule gets through the drop', () => {
    expect(won(3)).toBe(false)
    expect(won(3, { rule: 'buffer' })).toBe(true)
  })

  it('flapping: needs the calm option on the speed rule', () => {
    expect(won(4)).toBe(false)
    expect(won(4, { rule: 'buffer' })).toBe(false)
    expect(won(4, { calm: true })).toBe(true)
  })

  it('start fast: only a low start is quick on a slow connection', () => {
    const { st, goal } = challenge(5)
    expect(st.start).toBe('high')
    const start = (over: Partial<StreamState>) => {
      const cur = { ...st, ...over }
      const sim = new StreamSim()
      sim.apply(cur)
      for (let i = 0; i < 20 * 30; i++) sim.step()
      return goal.check({ m: sim.metrics, st: cur, sim })
    }
    expect(start({})).toBe(false)
    expect(start({ start: 'low' })).toBe(true)
  })

  it('which setup: needs a low start and the speed rule', () => {
    expect(won(6)).toBe(false)
    expect(won(6, { start: 'low' })).toBe(false)
    expect(won(6, { rule: 'throughput' })).toBe(false)
    expect(won(6, { start: 'low', rule: 'throughput' })).toBe(true)
    expect(won(6, { start: 'low', rule: 'throughput', calm: true })).toBe(true)
  })
})
