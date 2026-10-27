import { describe, expect, it } from 'vitest'
import { RealtimeSim } from './engine'
import type { RealtimeState } from './types'
import { TICKS_PER_SECOND } from './world'

const BASE: RealtimeState = {
  send: 0,
  talk: 0,
  check: 0,
  reply: 0,
  round: 0,
  mode: 'manual',
  interval: 5,
  phones: 1,
  servers: 1,
  flaky: false,
  heartbeat: false,
  backoff: false,
  crash: 0,
}

function run(st: RealtimeState, steps: ((s: RealtimeState) => RealtimeState)[], seconds = 15) {
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

const send = (s: RealtimeState) => ({ ...s, send: s.send + 1 })
const check = (s: RealtimeState) => ({ ...s, check: s.check + 1 })
const reply = (s: RealtimeState) => ({ ...s, reply: s.reply + 1 })
const crash = (s: RealtimeState) => ({ ...s, crash: s.crash + 1 })

describe('manual refresh', () => {
  it('a message waits at the server until the phone asks', () => {
    const { sim } = run(BASE, [send], 5)
    expect(sim.metrics.inbox).toBe(1)
    expect(sim.metrics.shown).toBe(0)
  })

  it('pulling to refresh shows it, and the delay is the wait', () => {
    const { sim } = run(BASE, [send, check], 5)
    expect(sim.metrics.shown).toBe(1)
    expect(sim.metrics.requests).toBe(1)
    expect(sim.metrics.lastDelay).toBeGreaterThan(5)
  })
})

describe('polling', () => {
  it('asks on a timer and mostly gets empty answers', () => {
    const { sim } = run({ ...BASE, mode: 'poll', interval: 2 }, [(s) => s], 20)
    expect(sim.metrics.requests).toBeGreaterThanOrEqual(9)
    expect(sim.metrics.empty).toBeGreaterThanOrEqual(8)
  })

  it('a message waits for the next ask, up to the interval', () => {
    const { sim } = run({ ...BASE, mode: 'poll', interval: 5 }, [send], 12)
    expect(sim.metrics.shown).toBe(1)
    expect(sim.metrics.lastDelay).toBeLessThan(5 + 1.5)
  })

  it('a shorter interval means shorter waits and more requests', () => {
    const slow = run({ ...BASE, mode: 'poll', interval: 10, talk: 0.3 }, [(s) => s], 60).sim.metrics
    const fast = run({ ...BASE, mode: 'poll', interval: 1, talk: 0.3 }, [(s) => s], 60).sim.metrics
    expect(fast.requests).toBeGreaterThan(slow.requests * 5)
  })
})

describe('long polling', () => {
  it('holds the ask while it is quiet', () => {
    const { sim } = run({ ...BASE, mode: 'long' }, [(s) => s], 4)
    expect(sim.heldAt).toBeGreaterThanOrEqual(0)
    expect(sim.metrics.requests).toBe(1)
    expect(sim.metrics.empty).toBe(0)
  })

  it('answers the held ask the moment a message arrives', () => {
    const { sim } = run({ ...BASE, mode: 'long' }, [(s) => s, send], 5)
    expect(sim.metrics.shown).toBe(1)
    expect(sim.metrics.lastDelay).toBeLessThan(1)
    expect(sim.metrics.requests).toBe(2)
  })

  it('times out empty, then asks again', () => {
    const { sim } = run({ ...BASE, mode: 'long' }, [(s) => s], 20)
    expect(sim.metrics.empty).toBeGreaterThanOrEqual(2)
    expect(sim.metrics.requests).toBeLessThan(6)
  })
})

describe('server-sent events', () => {
  it('uses one request however many messages arrive', () => {
    const { sim } = run({ ...BASE, mode: 'sse' }, [(s) => s, send, send, send], 3)
    expect(sim.metrics.shown).toBe(3)
    expect(sim.metrics.requests).toBe(1)
    expect(sim.metrics.lastDelay).toBeLessThan(1)
  })

  it('every reply is a new request', () => {
    const { sim } = run({ ...BASE, mode: 'sse' }, [(s) => s, reply, reply], 3)
    expect(sim.metrics.requests).toBe(3)
    expect(sim.metrics.heard).toBe(2)
  })
})

describe('websocket', () => {
  it('carries messages and replies on the one request', () => {
    const { sim } = run({ ...BASE, mode: 'ws' }, [(s) => s, send, send, reply, reply, reply], 3)
    expect(sim.metrics.shown).toBe(2)
    expect(sim.metrics.sent).toBe(3)
    expect(sim.metrics.heard).toBe(3)
    expect(sim.metrics.requests).toBe(1)
  })

  it('a message sent before the connection opens is delivered once it does', () => {
    const { sim } = run({ ...BASE, mode: 'ws' }, [send], 3)
    expect(sim.metrics.shown).toBe(1)
  })
})

describe('switching modes', () => {
  it('drops the old connection and opens a new one', () => {
    const { sim } = run({ ...BASE, mode: 'sse' }, [(s) => s, (s) => ({ ...s, mode: 'ws' })], 3)
    expect(sim.open).toBe(true)
    expect(sim.metrics.requests).toBe(1)
  })

  it('does not repeat a message when a state is replayed', () => {
    const sim = new RealtimeSim()
    const st = send(BASE)
    sim.apply(BASE)
    sim.apply(st)
    sim.apply(BASE)
    sim.apply(st)
    for (let t = 0; t < TICKS_PER_SECOND * 3; t++) sim.step()
    expect(sim.metrics.inbox).toBe(1)
  })
})

describe('a round restart', () => {
  it('starts every count from zero', () => {
    const { sim } = run({ ...BASE, mode: 'sse' }, [(s) => s, send, (s) => ({ ...s, round: s.round + 1 })], 3)
    expect(sim.metrics.shown).toBe(0)
    expect(sim.metrics.requests).toBe(1)
  })
})

describe('the crowd', () => {
  const crowd = { ...BASE, mode: 'ws' as const, phones: 1000 }

  it('connects every phone when there is room', () => {
    const { sim } = run(crowd, [(s) => s], 3)
    expect(sim.metrics.connected).toBe(1000)
    expect(sim.metrics.waiting).toBe(0)
  })

  it('leaves the phones that do not fit waiting', () => {
    const { sim } = run({ ...crowd, phones: 25000 }, [(s) => s], 5)
    expect(sim.metrics.connected).toBe(10000)
    expect(sim.metrics.waiting).toBe(15000)
    expect(run({ ...crowd, phones: 25000, servers: 4 }, [(s) => s], 5).sim.metrics.waiting).toBe(0)
  })

  it('dead connections pile up without a heartbeat and clear with one', () => {
    const flaky = { ...crowd, phones: 9000, flaky: true }
    const without = run(flaky, [(s) => s], 15).sim.metrics
    const withBeat = run({ ...flaky, heartbeat: true }, [(s) => s], 15).sim.metrics
    expect(without.dead).toBeGreaterThan(3000)
    expect(withBeat.dead).toBeLessThan(without.dead / 3)
    expect(withBeat.connected).toBeGreaterThan(without.connected)
  })

  it('a crash takes a server’s share of connections and they come back', () => {
    const { sim } = run({ ...crowd, phones: 40000, servers: 4, backoff: true }, [crash], 6)
    expect(sim.metrics.waiting).toBe(0)
    expect(sim.metrics.connected).toBe(40000)
    expect(sim.metrics.recovery).toBeGreaterThanOrEqual(0)
  })

  it('retrying at once makes the recovery much slower than waiting', () => {
    const base = { ...crowd, phones: 40000, servers: 4 }
    const patient = run({ ...base, backoff: true }, [crash], 30).sim.metrics.recovery
    const eager = run({ ...base, backoff: false }, [crash], 60).sim.metrics.recovery
    expect(patient).toBeLessThan(3)
    expect(eager).toBeGreaterThan(patient * 4)
  })
})
