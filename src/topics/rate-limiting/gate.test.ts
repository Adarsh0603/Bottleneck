import { describe, expect, it } from 'vitest'
import type { Placement } from '../../core/build/types'
import { API_GATEWAY, gatewayOf } from './build'
import { CHAPTERS } from './chapters'
import { RateSim } from './engine'
import { Gateway, TICKS_PER_SECOND, type Config } from './gate'
import type { RateState } from './types'

const run = (cfg: Partial<Config>, seconds: number) => {
  const g = new Gateway(() => 0.5)
  g.configure(cfg)
  for (let i = 0; i < seconds * TICKS_PER_SECOND; i++) g.flow.step()
  return g
}

describe('the algorithms', () => {
  it('with no limit, a flood drowns the API', () => {
    expect(run({ limiting: false, bot: 'flood' }, 10).tally.overload).toBeGreaterThan(30)
  })

  it('a limit for each client holds the bot and leaves A and B alone', () => {
    const g = run({ algo: 'fixed', limit: 4, bot: 'flood' }, 10)
    expect(g.tally.overload).toBe(0)
    expect(g.tally.rejected.ann + g.tally.rejected.bo).toBe(0)
    expect(g.rateOf('bot')).toBeCloseTo(4, 0)
  })

  it('one limit for everyone turns A away', () => {
    expect(run({ algo: 'fixed', limit: 4, scope: 'all', bot: 'flood' }, 10).tally.rejected.ann).toBeGreaterThan(0)
  })

  it('a fixed window lets a burst across the boundary through at double the limit', () => {
    expect(run({ algo: 'fixed', limit: 6, bot: 'edge' }, 20).tally.overload).toBeGreaterThan(0)
    expect(run({ algo: 'sliding', limit: 6, bot: 'edge' }, 20).tally.overload).toBe(0)
  })

  it('a token bucket lets an honest burst through, and a sliding window does not', () => {
    expect(run({ algo: 'sliding', limit: 3, bot: 'flood', annBursts: true }, 20).tally.rejected.ann).toBeGreaterThan(0)
    expect(run({ algo: 'token', limit: 3, burst: 4, bot: 'flood', annBursts: true }, 20).tally.rejected.ann).toBe(0)
    expect(run({ algo: 'token', limit: 3, burst: 2, bot: 'flood', annBursts: true }, 20).tally.rejected.ann).toBeGreaterThan(0)
  })

  it('a leaky bucket smooths a burst that a token bucket passes on', () => {
    const fragile = { limit: 3, burst: 4, bot: 'flood', annBursts: true, apiQueue: 3 } as const
    expect(run({ ...fragile, algo: 'token' }, 20).tally.overload).toBeGreaterThan(0)
    const leaky = run({ ...fragile, algo: 'leaky' }, 20)
    expect(leaky.tally.overload).toBe(0)
    expect(leaky.tally.rejected.ann).toBe(0)
    expect(leaky.waitMs).toBeGreaterThan(0)
  })

  it('gateways that count alone let through the limit times the gateways', () => {
    const cfg = { algo: 'sliding', limit: 4, bot: 'flood', gateways: 3 } as const
    expect(run({ ...cfg, shared: false }, 20).rateOf('bot')).toBeCloseTo(12, 0)
    expect(run({ ...cfg, shared: true }, 20).rateOf('bot')).toBeCloseTo(4, 0)
  })
})

// A chapter's challenge, tried against a particular setup.
function attempt(chapter: number, set: Partial<RateState>, seconds = 20) {
  const ch = CHAPTERS[chapter]
  const beat = ch.beats.find((b) => b.challenge)!
  const st = { ...ch.initial, ...beat.set, ...set }
  const sim = new RateSim(() => 0.5)
  sim.apply(st)
  for (let i = 0; i < seconds * TICKS_PER_SECOND; i++) sim.step()
  return beat.challenge!.check({ m: sim.metrics, st, sim })
}

describe('the practice challenges', () => {
  it('start unsolved', () => {
    for (const i of [0, 1, 2, 3, 4]) expect(attempt(i, {})).toBe(false)
  })

  it('too much traffic', () => {
    expect(attempt(0, { scope: 'client', limit: 4 })).toBe(true)
    expect(attempt(0, { scope: 'client', limit: 10 })).toBe(false)
    expect(attempt(0, { scope: 'all', limit: 5 })).toBe(false)
  })

  it('the fixed window', () => {
    expect(attempt(1, { algo: 'sliding', limit: 6 })).toBe(true)
    expect(attempt(1, { algo: 'sliding', limit: 10 })).toBe(false)
    expect(attempt(1, { algo: 'fixed', limit: 6 })).toBe(false)
  })

  it('the token bucket', () => {
    expect(attempt(2, { algo: 'token', limit: 3, burst: 4 })).toBe(true)
    expect(attempt(2, { algo: 'token', limit: 3, burst: 2 })).toBe(false)
    expect(attempt(2, { algo: 'sliding', limit: 5 })).toBe(false)
  })

  it('the leaky bucket', () => {
    expect(attempt(3, { algo: 'leaky', limit: 3, burst: 4 })).toBe(true)
    expect(attempt(3, { algo: 'leaky', limit: 3, burst: 2 })).toBe(false)
    expect(attempt(3, { algo: 'token', limit: 3, burst: 4 })).toBe(false)
  })

  it('many gateways', () => {
    expect(attempt(4, { shared: true, limit: 4 })).toBe(true)
    expect(attempt(4, { shared: false, limit: 4 })).toBe(false)
  })
})

// Build it: a setup is a placement and the learner's choices.
const GATES = ['gate-0', 'gate-1', 'gate-2']
function build(placed: Placement, settings: Record<string, number>, seconds = 40) {
  const flow = API_GATEWAY.assemble(placed, settings, () => 0.5)
  for (let i = 0; i < seconds * TICKS_PER_SECOND; i++) flow.step()
  const g = gatewayOf.get(flow)!
  return { ok: API_GATEWAY.check({} as never, placed, settings, flow), problem: API_GATEWAY.problem!({} as never, placed, settings, flow), g }
}

const two: Placement = { lb: 'balancer', 'gate-0': 'limiter', 'gate-1': 'limiter', counter: 'cache' }
// algo, limit, burst, scope — indexes into the options
const token = { algo: 2, limit: 2, burst: 1, scope: 1 } // token bucket, 4 a second, bucket of 4, each client

describe('Build it: the partner API', () => {
  it('is solved by a balancer, two gateways, a shared counter and a token bucket per client', () => {
    expect(build(two, token).ok).toBe(true)
    expect(build({ ...two, 'gate-2': 'limiter' }, token).ok).toBe(true)
  })

  it('has no solution without a limiter', () => {
    const r = build({}, token)
    expect(r.ok).toBe(false)
    expect(r.problem).toMatch(/rate limiter/)
  })

  it('one gateway cannot decide fast enough', () => {
    const r = build({ 'gate-0': 'limiter' }, token)
    expect(r.ok).toBe(false)
    expect(r.problem).toMatch(/One gateway/)
  })

  it('gateways without a balancer sit idle', () => {
    const r = build({ ...two, lb: undefined } as unknown as Placement, token)
    expect(r.ok).toBe(false)
  })

  it('a fixed window is beaten by the bursts', () => {
    const r = build(two, { ...token, algo: 0, limit: 4 })
    expect(r.ok).toBe(false)
    expect(r.problem).toBeTruthy()
  })

  it('counting for everyone turns A away', () => {
    const r = build(two, { ...token, scope: 0 })
    expect(r.ok).toBe(false)
    expect(r.problem).toMatch(/One count for everyone/)
  })

  it('counters that are not shared let the bot through', () => {
    const alone = { ...two }
    delete alone.counter
    const r = build({ ...alone, 'gate-2': 'limiter' }, { ...token, limit: 3 })
    expect(r.ok).toBe(false)
    expect(r.problem).toMatch(/counts alone/)
  })

  it('a bucket smaller than A’s burst turns it away', () => {
    const r = build(two, { ...token, burst: 0 })
    expect(r.ok).toBe(false)
    expect(r.problem).toMatch(/A/)
  })

  it('names every gateway pad', () => {
    expect(API_GATEWAY.pads.filter((p) => GATES.includes(p.id))).toHaveLength(3)
  })
})
