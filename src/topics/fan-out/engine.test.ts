import { describe, expect, it } from 'vitest'
import { stateAt } from '../../core/chapters'
import { CHAPTERS } from './chapters'
import { FanoutSim } from './engine'
import type { FanoutState } from './types'
import { TICKS_PER_SECOND } from './world'

const BASE: FanoutState = { open: 0, pace: 0, posting: 0, follows: 4, round: 0, mode: 'read', celeb: false, star: 0, skipIdle: false }

function run(st: FanoutState, steps: ((s: FanoutState) => FanoutState)[], seconds = 15) {
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

const open = (s: FanoutState) => ({ ...s, open: s.open + 1 })
const star = (s: FanoutState) => ({ ...s, star: s.star + 1 })

describe('fan-out on read', () => {
  it('one lookup per person followed, then a feed arrives', () => {
    const { sim } = run(BASE, [open])
    expect(sim.metrics.lookups).toBe(4)
    expect(sim.metrics.opened).toBe(1)
    expect(sim.metrics.waiting).toBe(0)
    expect(sim.metrics.queue).toBe(0)
  })

  it('following more people makes the feed slower, about one turn per follow', () => {
    const wait = (follows: number) => run({ ...BASE, follows }, [open], 60).sim.metrics.lastWait
    expect(wait(20)).toBeGreaterThan(wait(4))
    expect(wait(100)).toBeGreaterThan(wait(20))
    expect(wait(100)).toBeGreaterThan(5)
    expect(wait(4)).toBeLessThan(3)
  })

  it('shows the newest posts, and writes nothing to inboxes', () => {
    const { sim } = run({ ...BASE, follows: 2, posting: 4 }, [open], 6)
    expect(sim.feed.length).toBeGreaterThan(0)
    expect(sim.metrics.posted).toBeGreaterThan(0)
    expect(sim.metrics.writes).toBe(0)
  })

  it('many readers at once build a queue at the store', () => {
    const { sim } = run({ ...BASE, follows: 20, pace: 3 }, [(s) => s], 8)
    expect(sim.metrics.queue).toBeGreaterThan(10)
  })

  it('a new round starts the counts again', () => {
    const { sim } = run(BASE, [open, (s) => ({ ...s, round: s.round + 1 })], 15)
    expect(sim.metrics.opened).toBe(0)
    expect(sim.metrics.lookups).toBe(0)
  })

  it('a sim created partway through does not replay earlier opens or posts', () => {
    const { sim } = run({ ...BASE, open: 3, star: 2, celeb: true }, [(s) => s], 5)
    expect(sim.metrics.lookups).toBe(0)
    expect(sim.metrics.starPosts).toBe(0)
  })
})

describe('going back and forward', () => {
  it('does not repeat an open or a celebrity post', () => {
    const base = { ...BASE, mode: 'write' as const, celeb: true }
    const once = run(base, [star, open], 15).sim.metrics
    const again = run(base, [star, open, (s) => ({ ...s, star: 0, open: 0 }), (s) => ({ ...s, star: 1, open: 1 })], 15).sim.metrics
    expect(again.starPosts).toBe(once.starPosts)
    expect(again.writes).toBe(once.writes)
    expect(again.lookups).toBe(once.lookups)
  })

  it('still acts when a button raises a counter past its highest value', () => {
    const base = { ...BASE, mode: 'write' as const, celeb: true, star: 2 }
    const { sim } = run(base, [(s) => ({ ...s, star: 3 })], 5)
    expect(sim.metrics.starPosts).toBe(1)
  })
})

describe('fan-out on write', () => {
  const write = { ...BASE, mode: 'write' as const, follows: 500 }

  it('opening is one lookup however many people are followed', () => {
    const { sim } = run(write, [open], 10)
    expect(sim.metrics.lookups).toBe(1)
    expect(sim.metrics.opened).toBe(1)
    expect(sim.metrics.lastWait).toBeLessThan(3)
  })

  it('each normal post is one write per follower, and reaches the inbox', () => {
    const { sim } = run({ ...write, posting: 1 }, [(s) => s, (s) => ({ ...s, posting: 0 })], 6)
    expect(sim.metrics.delivered).toBeGreaterThan(0)
    expect(sim.metrics.delivered).toBe(sim.metrics.posted)
    expect(sim.metrics.writes).toBe(sim.metrics.delivered * 5)
    expect(sim.metrics.slowest).toBeLessThan(2)
  })

  it('the feed comes from the inbox once posts have been delivered', () => {
    const { sim } = run({ ...write, posting: 2 }, [(s) => s, open], 5)
    expect(sim.feed.length).toBeGreaterThan(0)
  })
})

describe('the celebrity problem', () => {
  const base = { ...BASE, mode: 'write' as const, celeb: true, follows: 20, posting: 2 }

  it('a celebrity post is 200 writes and holds up normal posts behind it', () => {
    const { sim } = run(base, [star], 15)
    expect(sim.metrics.starPosts).toBe(1)
    expect(sim.metrics.starWrites).toBe(200)
    expect(sim.metrics.slowest).toBeGreaterThanOrEqual(5)
  })

  it('without a celebrity post, normal posts are quick', () => {
    const { sim } = run(base, [(s) => s], 25)
    expect(sim.metrics.slowest).toBeLessThan(2)
  })

  it('a star click does nothing when there is no celebrity', () => {
    const { sim } = run({ ...base, celeb: false }, [star], 5)
    expect(sim.metrics.starPosts).toBe(0)
  })
})

describe('mixing both', () => {
  const base = { ...BASE, mode: 'hybrid' as const, celeb: true, follows: 20, posting: 2 }

  it('a celebrity post is not delivered, so nobody waits', () => {
    const { sim } = run(base, [star], 25)
    expect(sim.metrics.starPosts).toBe(1)
    expect(sim.metrics.slowest).toBeLessThan(2)
    expect(sim.metrics.backlog).toBeLessThan(10)
  })

  it('an open is one inbox lookup plus one for the celebrity', () => {
    const { sim } = run(base, [open], 10)
    expect(sim.metrics.lookups).toBe(2)
    expect(sim.metrics.opened).toBe(1)
  })

  it('the celebrity’s post still shows in the feed', () => {
    const { sim } = run({ ...base, posting: 0 }, [star, open], 8)
    expect(sim.feed).toEqual([true])
  })

  it('switching to hybrid after the celebrity posts lets the line drain', () => {
    const { sim } = run({ ...base, mode: 'write' }, [star, (s) => ({ ...s, mode: 'hybrid' })], 40)
    expect(sim.metrics.slowest).toBeLessThan(2)
  })
})

describe('skipping idle followers', () => {
  it('cuts a celebrity post to 80 writes', () => {
    const { sim } = run({ ...BASE, mode: 'write', celeb: true, follows: 20, skipIdle: true }, [star], 10)
    expect(sim.metrics.starWrites).toBe(80)
  })
})

describe('fan-out chapters', () => {
  it('every beat’s state runs in the sim', () => {
    for (const ch of CHAPTERS) {
      for (let i = 0; i < ch.beats.length; i++) {
        const st = stateAt(ch, i)
        expect(() => run(st, [(s) => s], 2)).not.toThrow()
      }
    }
  })
})
