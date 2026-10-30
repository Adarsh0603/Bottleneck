import { describe, expect, it } from 'vitest'
import { canDrop } from '../../core/build/placement'
import { Running } from '../../core/build/run'
import type { BuildTask, Placement, Settings } from '../../core/build/types'
import { FIRST_DESIGN, INTRO, NOTIFICATIONS, SCALE_UP } from './build'

const mulberry = (a: number) => {
  let t = (a + 0x6d2b79f5) | 0
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}
const lcg = (seed: number) => {
  let s = seed * 7919
  return () => mulberry(s++)
}

function win(task: BuildTask, placed: Placement, settings: Settings, seed?: number, seconds = 90) {
  const run = new Running(task.assemble(placed, settings, seed === undefined ? undefined : lcg(seed)))
  let held = 0
  for (let t = 0; t < seconds * 20; t++) {
    run.step()
    held = task.check(run.metrics(), placed, settings, run.flow) ? held + 1 : 0
    if (held >= task.holdSeconds * 20) return true
  }
  return false
}
const always = (t: BuildTask, p: Placement, s: Settings) => [undefined, 1, 2, 3, 4].every((n) => win(t, p, s, n))
const never = (t: BuildTask, p: Placement, s: Settings) => [undefined, 1, 2, 3, 4].every((n) => !win(t, p, s, n))

// Settings: attempts 0..3 = 1,2,3,5 tries · lanes 0/1 · pace 0..3 = 3,8,10,20 a second.
const GOOD: Placement = { q: 'queue', 'send-0': 'server', 'send-1': 'server', 'send-2': 'server', gate: 'limiter', dead: 'dead', dedupe: 'dedupe' }
const without = (p: Placement, ...ids: string[]): Placement => Object.fromEntries(Object.entries(p).filter(([id]) => !ids.includes(id)))
const GOOD_SET: Settings = { attempts: 3, lanes: 1, pace: 1 }

describe('first design', () => {
  const placed: Placement = { q: 'queue', 'send-0': 'server', 'send-1': 'server' }
  it('wins with a queue, senders and retries', () => {
    expect(always(FIRST_DESIGN, placed, { attempts: 2 })).toBe(true)
    expect(always(FIRST_DESIGN, placed, { attempts: 3 })).toBe(true)
  })
  it('fails with a single try', () => {
    expect(never(FIRST_DESIGN, placed, { attempts: 0 })).toBe(true)
  })
  it('fails without a queue or without senders', () => {
    expect(never(FIRST_DESIGN, { 'send-0': 'server' }, { attempts: 2 })).toBe(true)
    expect(never(FIRST_DESIGN, { q: 'queue' }, { attempts: 2 })).toBe(true)
  })
})

describe('where it breaks', () => {
  it('wins with the full design', () => {
    expect(always(SCALE_UP, GOOD, GOOD_SET)).toBe(true)
  })
  it('fails with one shared line', () => {
    expect(never(SCALE_UP, GOOD, { ...GOOD_SET, lanes: 0 })).toBe(true)
  })
  it('fails without the pacer', () => {
    expect(never(SCALE_UP, without(GOOD, 'gate'), GOOD_SET)).toBe(true)
  })
  it('fails paced above the email limit', () => {
    expect(never(SCALE_UP, GOOD, { ...GOOD_SET, pace: 2 })).toBe(true)
  })
  it('fails paced too slowly', () => {
    expect(never(SCALE_UP, GOOD, { ...GOOD_SET, pace: 0 })).toBe(true)
  })
  it('fails without the dedupe store', () => {
    expect(never(SCALE_UP, without(GOOD, 'dedupe'), GOOD_SET)).toBe(true)
  })
  it('fails with one try, even with everything else', () => {
    expect(never(SCALE_UP, GOOD, { ...GOOD_SET, attempts: 0 })).toBe(true)
  })
  it('needs dead letters when it gives up after three tries', () => {
    expect(never(SCALE_UP, without(GOOD, 'dead'), { ...GOOD_SET, attempts: 2 })).toBe(true)
    expect(always(SCALE_UP, GOOD, { ...GOOD_SET, attempts: 2 })).toBe(true)
  })
  it('wins without dead letters when five tries outlast the outage', () => {
    expect(always(SCALE_UP, without(GOOD, 'dead'), { ...GOOD_SET, attempts: 3 })).toBe(true)
  })
  it('fails with one sender', () => {
    expect(never(SCALE_UP, without(GOOD, 'send-1', 'send-2'), GOOD_SET)).toBe(true)
  })
})

describe('intro', () => {
  it('delivers a message from the app to the phone network', () => {
    const run = new Running(INTRO.task.assemble({}, {}))
    for (let t = 0; t < 15 * 20; t++) run.step()
    expect(run.flow.stats.completed).toBeGreaterThan(5)
    expect(run.flow.stats.dropped).toBe(0)
    for (const s of INTRO.steps) if (s.at) expect(INTRO.task.fixed.some((f) => f.id === s.at)).toBe(true)
  })
})

describe('requirements', () => {
  it('points every estimate question at a piece on the intro board', () => {
    for (const q of NOTIFICATIONS.estimate.questions) {
      expect(q.show).toBeTruthy()
      expect(INTRO.task.fixed.some((f) => f.id === q.at)).toBe(true)
    }
    expect(NOTIFICATIONS.goals?.length).toBeGreaterThan(0)
  })
})

describe('clarity', () => {
  const runTo = (placed: Placement, seconds: number) => {
    const run = new Running(SCALE_UP.assemble(placed, GOOD_SET))
    for (let t = 0; t < seconds * 20; t++) run.step()
    return run
  }
  it('still wins with the decoys on the board, and says they do nothing', () => {
    const decoys: Placement = { ...GOOD, 'spare-0': 'cache', 'spare-1': 'balancer' }
    expect(always(SCALE_UP, decoys, GOOD_SET)).toBe(true)
    const run = runTo(decoys, 10)
    expect(SCALE_UP.problem!(run.metrics(), decoys, GOOD_SET, run.flow)).toMatch(/cache/i)
  })
  it('tells the cause and where to look, without naming the fix', () => {
    const run = runTo(without(GOOD, 'dead'), 30)
    const d = SCALE_UP.diagnose!(run.metrics(), without(GOOD, 'dead'), GOOD_SET, run.flow)
    if (d) {
      expect(d.because.length).toBeGreaterThan(0)
      expect(d.look).toMatch(/\?|\.$/)
    }
    const none = FIRST_DESIGN.diagnose!(new Running(FIRST_DESIGN.assemble({}, {})).metrics(), {}, {}, new Running(FIRST_DESIGN.assemble({}, {})).flow)
    expect(none?.look).toMatch(/between the front door/)
    expect(none?.because).not.toMatch(/\d/)
  })
  it('lets any piece go on any pad', () => {
    for (const task of [FIRST_DESIGN, SCALE_UP])
      for (const pad of task.pads) for (const { kind } of task.toolbox) expect(canDrop(task, {}, pad.id, kind)).toBe(true)
  })
  it('works in any arrangement that keeps the order', () => {
    const other: Placement = { 'spare-0': 'limiter', 'spare-1': 'queue', 'send-0': 'server', 'send-1': 'server', 'send-2': 'server', dedupe: 'dead', dead: 'dedupe', gate: 'cache' }
    expect(always(SCALE_UP, other, GOOD_SET)).toBe(true)
  })
  it('breaks when a part stands ahead of one that should come first', () => {
    const serverFirst: Placement = { ...without(GOOD, 'q', 'send-0'), gate: 'limiter', 'spare-0': 'server', 'spare-1': 'queue' }
    expect(never(SCALE_UP, { ...without(GOOD, 'q', 'gate'), q: 'server', 'spare-1': 'queue', gate: 'limiter' }, GOOD_SET)).toBe(true)
    expect(never(SCALE_UP, serverFirst, GOOD_SET)).toBe(true)
    const run = new Running(SCALE_UP.assemble(serverFirst, GOOD_SET))
    for (let t = 0; t < 10 * 20; t++) run.step()
    expect(SCALE_UP.problem!(run.metrics(), serverFirst, GOOD_SET, run.flow)).toMatch(/^The server stands in front of the/)
    expect(SCALE_UP.requirements!.some((r) => !r.read(run.flow, run.metrics()).ok)).toBe(true)
  })
  it('breaks with the dedupe store ahead of the senders, or the queue ahead of the pacer', () => {
    expect(never(SCALE_UP, { ...without(GOOD, 'dedupe', 'send-0'), 'send-0': 'dedupe', dedupe: 'server' }, GOOD_SET)).toBe(true)
    expect(never(SCALE_UP, { ...without(GOOD, 'gate', 'q'), gate: 'queue', q: 'limiter' }, GOOD_SET)).toBe(true)
  })
  it('says when the day is over and counts what is still on its way', () => {
    expect(SCALE_UP.statusNote!(runTo(GOOD, 20).flow)).toBeNull()
    expect(SCALE_UP.statusNote!(runTo(GOOD, 53).flow)).toMatch(/^Day over/)
    expect(SCALE_UP.statusNote!(runTo(GOOD, 70).flow)).toBe('Day over. Every message is accounted for.')
  })
  it('names the phase in which a requirement first failed', () => {
    const placed = without(GOOD, 'gate')
    const run = new Running(SCALE_UP.assemble(placed, { ...GOOD_SET, lanes: 0 }))
    for (let t = 0; t < 75 * 20; t++) run.step()
    const reads = SCALE_UP.requirements!.map((r) => r.read(run.flow, run.metrics()))
    expect(reads.some((r) => !r.ok && /first in “/.test(r.text))).toBe(true)
  })
  it('lays the timeline over the whole run', () => {
    const { phases, end } = SCALE_UP.timeline!
    expect(phases[0].from).toBe(0)
    expect(phases.every((p, i) => i === 0 || p.from > phases[i - 1].from)).toBe(true)
    expect(end).toBeGreaterThan(phases[phases.length - 1].from)
  })
})

describe('fail fast', () => {
  const firstBroken = (task: BuildTask, placed: Placement, settings: Settings, seconds: number) => {
    const run = new Running(task.assemble(placed, settings))
    for (let t = 0; t < seconds * 20; t++) {
      run.step()
      const r = task.requirements!.find((q) => !q.read(run.flow, run.metrics()).ok)
      if (r) return { label: r.label, second: run.flow.tick / 20 }
    }
    return null
  }
  it('is on for both build stages', () => {
    expect(FIRST_DESIGN.failFast).toBe(true)
    expect(SCALE_UP.failFast).toBe(true)
  })
  it('never breaks a design that wins', () => {
    expect(firstBroken(SCALE_UP, GOOD, GOOD_SET, 75)).toBeNull()
    expect(firstBroken(FIRST_DESIGN, { q: 'queue', 'send-0': 'server', 'send-1': 'server' }, { attempts: 2 }, 30)).toBeNull()
  })
  it('stops a bad design as soon as it starts losing messages', () => {
    const early = firstBroken(FIRST_DESIGN, { q: 'queue', 'send-0': 'server', 'send-1': 'server' }, { attempts: 0 }, 30)
    expect(early).not.toBeNull()
    expect(early!.second).toBeLessThan(25)
    const blast = firstBroken(SCALE_UP, without(GOOD, 'gate'), GOOD_SET, 75)
    expect(blast).not.toBeNull()
    expect(blast!.second).toBeLessThan(52)
  })
})
