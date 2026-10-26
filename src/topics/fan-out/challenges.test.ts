import { describe, expect, it } from 'vitest'
import { stateAt } from '../../core/chapters'
import { CHAPTERS } from './chapters'
import { FanoutSim } from './engine'
import type { FanoutState } from './types'
import { TICKS_PER_SECOND } from './world'

// The state at a chapter's practice challenge, with its checker.
function challenge(chapter: number) {
  const ch = CHAPTERS[chapter]
  const beat = ch.beats.findIndex((b) => b.challenge)
  return { st: stateAt(ch, beat), goal: ch.beats[beat].challenge! }
}

function play(st: FanoutState, steps: ((s: FanoutState) => FanoutState)[], seconds = 40) {
  const sim = new FanoutSim()
  let cur = st
  sim.apply(cur)
  for (const step of steps) {
    cur = step(cur)
    sim.apply(cur)
    for (let t = 0; t < TICKS_PER_SECOND * seconds; t++) sim.step()
  }
  return { sim, st: cur }
}

const won = (r: { sim: FanoutSim; st: FanoutState }, goal: ReturnType<typeof challenge>['goal']) =>
  goal.check({ m: r.sim.metrics, st: r.st, sim: r.sim })

const open = (s: FanoutState) => ({ ...s, open: s.open + 1 })
const star = (s: FanoutState) => ({ ...s, star: s.star + 1 })
const mode = (m: FanoutState['mode']) => (s: FanoutState) => ({ ...s, mode: m })

describe('fan-out challenges', () => {
  it('build it when they open: not won until a big follow count is opened', () => {
    const { st, goal } = challenge(1)
    expect(won(play(st, [(s) => s]), goal)).toBe(false)
    expect(won(play(st, [open]), goal)).toBe(false)
    for (const follows of [100, 500]) {
      expect(won(play(st, [(s) => ({ ...s, follows }), open], 60), goal), `${follows} follows`).toBe(true)
    }
  })

  it('deliver when they post: only a fast open in write mode wins', () => {
    const { st, goal } = challenge(2)
    expect(st.follows).toBe(500)
    expect(won(play(st, [open], 60), goal)).toBe(false)
    expect(won(play(st, [mode('write'), open], 10), goal)).toBe(true)
    expect(won(play(st, [mode('write')], 10), goal)).toBe(false)
  })

  it('the celebrity problem: needs the celebrity to post in write mode', () => {
    const { st, goal } = challenge(3)
    expect(st.celeb).toBe(true)
    expect(won(play(st, [(s) => s], 25), goal)).toBe(false)
    expect(won(play(st, [star], 15), goal)).toBe(true)
  })

  it('mix both: only hybrid wins, and not by never posting', () => {
    const { st, goal } = challenge(4)
    expect(won(play(st, [(s) => s, open], 15), goal)).toBe(false)
    expect(won(play(st, [star, open], 25), goal)).toBe(false)
    expect(won(play(st, [mode('hybrid'), star, open], 15), goal)).toBe(true)
    expect(won(play(st, [mode('read'), star, open], 15), goal)).toBe(false)
  })

  it('inboxes in real life: skipping idle followers before the post wins', () => {
    const { st, goal } = challenge(5)
    expect(st.skipIdle).toBe(false)
    expect(won(play(st, [star], 10), goal)).toBe(false)
    expect(won(play(st, [(s) => ({ ...s, skipIdle: true }), star], 10), goal)).toBe(true)
  })
})
