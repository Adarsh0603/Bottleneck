import { describe, expect, it } from 'vitest'
import type { Placement } from '../../core/build/types'
import { CIRCUIT_SHOP, shopOf } from './build'
import { CHAPTERS } from './chapters'
import { ShopSim } from './engine'
import { Shop, TICKS_PER_SECOND, type Config } from './shop'
import type { ShopState } from './types'

const run = (cfg: Partial<Config>, seconds: number) => {
  const s = new Shop(() => 0.5)
  s.configure(cfg)
  for (let i = 0; i < seconds * TICKS_PER_SECOND; i++) s.flow.step()
  return s
}

describe('the shop and its services', () => {
  it('a healthy shop answers everyone', () => {
    const t = run({}, 20).tally
    expect(t.failed.browse + t.failed.checkout).toBe(0)
  })

  it('a slow service takes the whole shop down', () => {
    const t = run({ pay: 'slow' }, 20).tally
    expect(t.failed.browse).toBeGreaterThan(20)
    expect(t.ok.checkout).toBe(0)
  })

  it('more threads hold off the end', () => {
    expect(run({ pay: 'slow', threads: 16 }, 20).tally.failed.browse).toBe(0)
    expect(run({ pay: 'slow', threads: 12 }, 20).tally.failed.browse).toBeGreaterThan(0)
  })

  it('a timeout frees the thread, but not one that is too short', () => {
    const mixed = { pay: 'mixed', threads: 4 } as const
    expect(run({ ...mixed, timeout: 0 }, 20).tally.failed.browse).toBeGreaterThan(0)
    expect(run({ ...mixed, timeout: 1 }, 20).tally.failed.browse).toBe(0)
    expect(run({ ...mixed, timeout: 0.25 }, 20).tally.ok.checkout).toBe(0)
  })

  it('retries ride out a blip, if they wait', () => {
    const blip = { pay: 'blip', timeout: 1 } as const
    expect(run({ ...blip, retries: 0 }, 30).tally.failed.checkout).toBeGreaterThan(10)
    expect(run({ ...blip, retries: 3, backoff: 'none' }, 30).tally.failed.checkout).toBeGreaterThan(5)
    expect(run({ ...blip, retries: 3, backoff: 'exp' }, 30).tally.failed.checkout).toBe(0)
  })

  it('retrying at once multiplies the load on a service that is failing', () => {
    const blip = { pay: 'blip', timeout: 1, retries: 3 } as const
    expect(run({ ...blip, backoff: 'none' }, 30).deps.pay.overloaded).toBeGreaterThan(run({ ...blip, backoff: 'exp' }, 30).deps.pay.overloaded)
  })

  it('a breaker keeps the pages up through an outage', () => {
    const outage = { pay: 'outage', timeout: 1, retries: 2, backoff: 'exp' } as const
    expect(run(outage, 40).tally.failed.browse).toBeGreaterThan(0)
    const s = run({ ...outage, breaker: { pay: true, rev: false } }, 40)
    expect(s.tally.failed.browse).toBe(0)
    expect(s.tally.shed.pay).toBeGreaterThan(0)
  })

  it('a breaker that opens late, or tests late, costs something', () => {
    const cfg = { pay: 'outage', timeout: 1, retries: 2, backoff: 'exp', breaker: { pay: true, rev: false } } as const
    expect(run({ ...cfg, trip: 10 }, 40).tally.failed.browse).toBeGreaterThan(0)
    expect(run({ ...cfg, trip: 5, cooldown: 10 }, 40).tally.needless).toBeGreaterThan(run({ ...cfg, trip: 5, cooldown: 3 }, 40).tally.needless)
  })

  it('a breaker closes again once the service is back', () => {
    const s = run({ pay: 'outage', timeout: 1, breaker: { pay: true, rev: false }, cooldown: 1 }, 20)
    expect(s.breakers.pay.state).toBe('closed')
    expect(s.tally.ok.checkout).toBeGreaterThan(25)
  })

  it('without a fallback a page fails when its reviews do', () => {
    const cfg = { reviews: true, rev: 'down', timeout: 1 } as const
    expect(run({ ...cfg, fallback: false }, 20).tally.failed.browse).toBeGreaterThan(40)
    const s = run({ ...cfg, fallback: true }, 20)
    expect(s.tally.failed.browse).toBe(0)
    expect(s.tally.degraded.browse).toBeGreaterThan(40)
  })

  it('a fallback that waits too long is no use', () => {
    expect(run({ reviews: true, rev: 'down', timeout: 4, fallback: true }, 20).tally.failed.browse).toBeGreaterThan(0)
  })

  it('a bulkhead keeps a slow service from taking every thread', () => {
    const cfg = { reviews: true, rev: 'slow', timeout: 2, fallback: true } as const
    expect(run({ ...cfg, pool: 0 }, 30).tally.failed.checkout).toBeGreaterThan(0)
    expect(run({ ...cfg, pool: 2 }, 30).tally.failed.checkout).toBe(0)
    expect(run({ ...cfg, pool: 4 }, 30).tally.failed.checkout).toBe(0)
  })
})

// A chapter's challenge, tried against a particular setup.
function attempt(chapter: number, set: Partial<ShopState>, seconds = 40) {
  const ch = CHAPTERS[chapter]
  const beat = ch.beats.find((b) => b.challenge)!
  const st = { ...ch.initial, ...beat.set, ...set }
  const sim = new ShopSim(() => 0.5)
  sim.apply(st)
  for (let i = 0; i < seconds * TICKS_PER_SECOND; i++) sim.step()
  return beat.challenge!.check({ m: sim.metrics, st, sim })
}

describe('the practice challenges', () => {
  it('start unsolved', () => {
    for (const i of [0, 1, 2, 3, 4, 5]) expect(attempt(i, {})).toBe(false)
  })

  it('one slow dependency', () => {
    expect(attempt(0, { threads: 16 })).toBe(true)
    expect(attempt(0, { threads: 12 })).toBe(false)
  })

  it('timeouts', () => {
    expect(attempt(1, { timeout: 1 })).toBe(true)
    expect(attempt(1, { timeout: 2 })).toBe(true)
    expect(attempt(1, { timeout: 0.25 })).toBe(false)
    expect(attempt(1, { timeout: 4 })).toBe(false)
    expect(attempt(1, { timeout: 0 })).toBe(false)
  })

  it('retries', () => {
    expect(attempt(2, { retries: 3, backoff: 'exp' })).toBe(true)
    expect(attempt(2, { retries: 3, backoff: 'none' })).toBe(false)
    expect(attempt(2, { retries: 1, backoff: 'exp' })).toBe(false)
  })

  it('the circuit breaker', () => {
    expect(attempt(3, { breaker: true, trip: 5, cooldown: 3 })).toBe(true)
    expect(attempt(3, { breaker: true, trip: 3, cooldown: 1 })).toBe(true)
    expect(attempt(3, { breaker: true, trip: 10, cooldown: 3 })).toBe(false)
    expect(attempt(3, { breaker: true, trip: 5, cooldown: 10 })).toBe(false)
    expect(attempt(3, { breaker: false, trip: 5, cooldown: 3 })).toBe(false)
  })

  it('fallbacks', () => {
    expect(attempt(4, { fallback: true, timeout: 1 })).toBe(true)
    expect(attempt(4, { fallback: true, timeout: 0.5 })).toBe(true)
    expect(attempt(4, { fallback: true, timeout: 0.25 })).toBe(false)
    expect(attempt(4, { fallback: true, timeout: 4 })).toBe(false)
    expect(attempt(4, { fallback: false, timeout: 1 })).toBe(false)
  })

  it('bulkheads', () => {
    expect(attempt(5, { pool: 2 })).toBe(true)
    expect(attempt(5, { pool: 4 })).toBe(true)
    expect(attempt(5, { pool: 0 })).toBe(false)
  })
})

// Build it: a setup is a placement and the learner's choices.
function build(placed: Placement, settings: Record<string, number>, seconds = 55) {
  const flow = CIRCUIT_SHOP.assemble(placed, settings, () => 0.5)
  for (let i = 0; i < seconds * TICKS_PER_SECOND; i++) flow.step()
  const s = shopOf.get(flow)!
  return { ok: CIRCUIT_SHOP.check({} as never, placed, settings, flow), problem: CIRCUIT_SHOP.problem!({} as never, placed, settings, flow), s }
}

// timeout, retries, backoff, pool, trip, cooldown — indexes into the options
const base = { timeout: 5, retries: 0, backoff: 0, pool: 0, trip: 2, cooldown: 3 }
const guarded: Placement = { 'b-pay': 'breaker', 'b-rev': 'breaker', 'c-rev': 'cache' }
// Give up after 1 second, one retry that waits, open after 5 failures, test after 3 seconds.
const good = { ...base, timeout: 2, retries: 1, backoff: 1, trip: 2, cooldown: 1 }

describe('Build it: the weekend sale', () => {
  it('is solved by breakers on both roads, saved ratings and a sensible policy', () => {
    expect(build(guarded, good).ok).toBe(true)
  })

  it('has no solution with nothing placed', () => {
    const r = build({}, good)
    expect(r.ok).toBe(false)
    expect(r.problem).toBeTruthy()
  })

  it('no timeout, and threads run out', () => {
    const r = build(guarded, { ...good, timeout: 5 })
    expect(r.ok).toBe(false)
    expect(r.problem).toMatch(/no timeout/i)
  })

  it('a long timeout is longer than a customer will wait', () => {
    const r = build(guarded, { ...good, timeout: 4 })
    expect(r.ok).toBe(false)
    expect(r.problem).toMatch(/shorter/)
  })

  it('without saved ratings, a page fails when Reviews does', () => {
    const r = build({ 'b-pay': 'breaker', 'b-rev': 'breaker' }, good)
    expect(r.ok).toBe(false)
    expect(r.problem).toMatch(/saved ratings/)
  })

  it('without a breaker on Payments, the outage empties the pool', () => {
    const r = build({ 'b-rev': 'breaker', 'c-rev': 'cache' }, good)
    expect(r.ok).toBe(false)
    expect(r.s.tally.failed.browse).toBeGreaterThan(3)
  })

  it('a rate limiter turns away real customers', () => {
    const r = build({ ...guarded, front: 'limiter' }, good)
    expect(r.ok).toBe(false)
    expect(r.problem).toMatch(/limiter/)
  })

  it('more threads only delay the end', () => {
    const r = build({ extra: 'server' }, { ...base, timeout: 3 })
    expect(r.ok).toBe(false)
  })

  it('a breaker that waits long to test turns checkouts away for nothing', () => {
    const r = build(guarded, { ...good, cooldown: 2 })
    expect(r.ok).toBe(false)
  })

  it('with no retries, the calls that hang cost checkouts', () => {
    const r = build(guarded, { ...good, retries: 0, backoff: 0 })
    expect(r.ok).toBe(false)
    expect(r.problem).toMatch(/hang|try again/i)
  })

  it('a breaker that opens late lets the pool run dry', () => {
    const r = build(guarded, { ...good, trip: 3 })
    expect(r.ok).toBe(false)
  })

  it('a thread limit applies to Payments too', () => {
    const r = build({ 'b-pay': 'breaker', 'c-rev': 'cache' }, { ...good, pool: 2 })
    expect(r.ok).toBe(false)
    expect(r.problem).toMatch(/thread limit/)
  })

  it('names every pad', () => {
    expect(CIRCUIT_SHOP.pads.map((p) => p.id).sort()).toEqual(['b-pay', 'b-rev', 'c-rev', 'extra', 'front'])
  })
})
