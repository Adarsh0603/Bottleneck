import { describe, expect, it } from 'vitest'
import { stateAt } from '../../core/chapters'
import { CHAPTERS } from './chapters'
import { RealtimeSim } from './engine'
import type { Mode, RealtimeState } from './types'
import { TICKS_PER_SECOND } from './world'

// The state at a chapter's practice challenge, with its checker.
function challenge(chapter: number) {
  const ch = CHAPTERS[chapter]
  const beat = ch.beats.findIndex((b) => b.challenge)
  return { st: stateAt(ch, beat), goal: ch.beats[beat].challenge! }
}

function play(st: RealtimeState, steps: ((s: RealtimeState) => RealtimeState)[], seconds = 20) {
  const sim = new RealtimeSim()
  let cur = st
  sim.apply(cur)
  for (const step of steps) {
    cur = step(cur)
    sim.apply(cur)
    for (let t = 0; t < TICKS_PER_SECOND * seconds; t++) sim.step()
  }
  return { sim, st: cur }
}

const won = (r: { sim: RealtimeSim; st: RealtimeState }, goal: ReturnType<typeof challenge>['goal']) =>
  goal.check({ m: r.sim.metrics, st: r.st, sim: r.sim })

const send = (s: RealtimeState) => ({ ...s, send: s.send + 1 })
const reply = (s: RealtimeState) => ({ ...s, reply: s.reply + 1 })
const check = (s: RealtimeState) => ({ ...s, check: s.check + 1 })
const crash = (s: RealtimeState) => ({ ...s, crash: s.crash + 1 })
const mode = (m: Mode) => (s: RealtimeState) => ({ ...s, mode: m })
const interval = (n: number) => (s: RealtimeState) => ({ ...s, interval: n })
const backoff = (s: RealtimeState) => ({ ...s, backoff: true })

describe('real-time challenges', () => {
  it('the stale screen: only a long wait before the refresh wins', () => {
    const { st, goal } = challenge(0)
    expect(won(play(st, [send, check], 1), goal)).toBe(false)
    const waited = play(st, [send], 8)
    expect(won(waited, goal)).toBe(false)
    const refreshed = check(waited.st)
    waited.sim.apply(refreshed)
    for (let t = 0; t < TICKS_PER_SECOND * 2; t++) waited.sim.step()
    expect(won({ sim: waited.sim, st: refreshed }, goal)).toBe(true)
  })

  it('ask again and again: needs a short interval and a message', () => {
    const { st, goal } = challenge(1)
    expect(st.mode).toBe('poll')
    expect(won(play(st, [(s) => s], 40), goal)).toBe(false)
    expect(won(play(st, [send], 12), goal)).toBe(false)
    expect(won(play(st, [interval(10), send], 15), goal)).toBe(false)
    expect(won(play(st, [interval(1), send], 6), goal)).toBe(true)
  })

  it('wait on the line: only long polling gives three fast messages', () => {
    const { st, goal } = challenge(2)
    expect(st.mode).toBe('poll')
    expect(won(play(st, [(s) => s], 40), goal)).toBe(false)
    expect(won(play(st, [mode('long'), send, send, send], 4), goal)).toBe(true)
    expect(won(play(st, [send, send, send], 12), goal)).toBe(false)
    // Slow messages shown while polling do not count against a switch to long polling.
    expect(won(play(st, [(s) => s, mode('long')], 40), goal)).toBe(true)
  })

  it('the server speaks first: three messages on one request', () => {
    const { st, goal } = challenge(3)
    expect(won(play(st, [mode('sse'), send, send, send], 4), goal)).toBe(true)
    expect(won(play(st, [mode('sse'), send, send, reply, send], 4), goal)).toBe(false)
    // Requests made while polling do not count against the switch.
    expect(won(play(st, [(s) => s, mode('sse'), send, send, send], 6), goal)).toBe(true)
    const part = play(st, [mode('sse'), send, send], 3)
    expect(goal.progress!({ m: part.sim.metrics, st: part.st, sim: part.sim })).toBeCloseTo(2 / 3)
    expect(won(play(st, [mode('long'), send, send, send], 4), goal)).toBe(false)
  })

  it('talk both ways: replies are free on a WebSocket only', () => {
    const { st, goal } = challenge(4)
    expect(st.mode).toBe('sse')
    expect(won(play(st, [mode('ws'), send, send, send, reply, reply, reply], 3), goal)).toBe(true)
    expect(won(play(st, [send, send, send, reply, reply, reply], 3), goal)).toBe(false)
    expect(won(play(st, [mode('ws'), send, send, send], 3), goal)).toBe(false)
  })

  it('a million open connections: only waiting before retrying recovers in time', () => {
    const { st, goal } = challenge(5)
    expect(st.backoff).toBe(false)
    expect(won(play(st, [crash], 60), goal)).toBe(false)
    expect(won(play(st, [backoff, crash], 10), goal)).toBe(true)
    expect(won(play(st, [backoff], 10), goal)).toBe(false)
  })
})
