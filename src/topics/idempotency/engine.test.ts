import { describe, expect, it } from 'vitest'
import { IdempotencySim } from './engine'
import type { IdempotencyState } from './types'
import { TICKS_PER_SECOND } from './world'

const BASE: IdempotencyState = { tap: 0, pace: 0, lose: 'none', retry: true, op: 'add', keys: 'none', double: false, crash: false, together: false, sender: 'phone' }

// Starts clean, taps once, and runs for a while.
function pay(st: Partial<IdempotencyState>, seconds = 12, taps = 1) {
  const sim = new IdempotencySim()
  const base = { ...BASE, ...st }
  sim.apply(base)
  for (let i = 1; i <= taps; i++) {
    sim.apply({ ...base, tap: i })
    for (let t = 0; t < TICKS_PER_SECOND * 4; t++) sim.step()
  }
  for (let t = 0; t < TICKS_PER_SECOND * seconds; t++) sim.step()
  return sim
}

describe('idempotency: a healthy network', () => {
  it('charges once and tells the phone', () => {
    const m = pay({}).metrics
    expect(m).toMatchObject({ orders: 1, paid: 1, charges: 1, dupes: 0, retries: 0 })
  })
})

describe('idempotency: lost messages', () => {
  it('a lost request is retried and charged once', () => {
    const m = pay({ lose: 'request' }).metrics
    expect(m).toMatchObject({ paid: 1, charges: 1, dupes: 0 })
    expect(m.retries).toBe(1)
  })

  it('a lost reply, retried, charges twice with no key', () => {
    const m = pay({ lose: 'reply' }).metrics
    expect(m).toMatchObject({ paid: 1, charges: 2, dupes: 1 })
  })

  it('without retries a lost request leaves the payment unknown', () => {
    const m = pay({ lose: 'request', retry: false }).metrics
    expect(m).toMatchObject({ paid: 0, unknown: 1, charges: 0 })
  })
})

describe('idempotency: repeat-safe actions', () => {
  it('"set" ignores the repeat', () => {
    const m = pay({ lose: 'reply', op: 'set' }).metrics
    expect(m).toMatchObject({ paid: 1, charges: 1, dupes: 0 })
  })
})

describe('idempotency: keys', () => {
  for (const keys of ['check', 'atomic'] as const) {
    it(`${keys}: a retry gets the saved answer`, () => {
      const m = pay({ lose: 'reply', keys }).metrics
      expect(m).toMatchObject({ paid: 1, charges: 1, dupes: 0, replays: 1 })
    })
  }

  it('check then charge lets a double tap through', () => {
    const m = pay({ double: true, keys: 'check' }).metrics
    expect(m.dupes).toBe(1)
  })

  it('claiming the key first stops a double tap', () => {
    const m = pay({ double: true, keys: 'atomic' }).metrics
    expect(m).toMatchObject({ paid: 1, charges: 1, dupes: 0 })
  })
})

describe('idempotency: a crash mid-payment', () => {
  it('saving the key after the charge loses it in the crash', () => {
    const m = pay({ crash: true, keys: 'atomic' }).metrics
    expect(m).toMatchObject({ crashes: 1, paid: 1, charges: 2, dupes: 1 })
  })

  it('saving charge and key together survives the crash', () => {
    const m = pay({ crash: true, keys: 'atomic', together: true }).metrics
    expect(m).toMatchObject({ crashes: 1, paid: 1, charges: 1, dupes: 0, replays: 1 })
  })
})

describe('idempotency: fresh start on a change', () => {
  it('clears the ledger when a setting changes', () => {
    const sim = pay({ lose: 'reply' })
    expect(sim.metrics.dupes).toBe(1)
    sim.apply({ ...BASE, lose: 'reply', keys: 'atomic' })
    expect(sim.metrics.charges).toBe(0)
  })

  it('does not clear it for a new tap', () => {
    const m = pay({}, 6, 3).metrics
    expect(m).toMatchObject({ orders: 3, charges: 3 })
  })
})

describe('idempotency: automatic sends', () => {
  const AUTO = { ...BASE, sender: 'queue' as const, lose: 'reply' as const, crash: true, pace: 0.5 }

  function auto(st: IdempotencyState, seconds: number) {
    const sim = new IdempotencySim()
    sim.apply(st)
    for (let t = 0; t < TICKS_PER_SECOND * seconds; t++) sim.step()
    return sim.metrics
  }

  it('counts each message once with a key saved together with the work', () => {
    const m = auto({ ...AUTO, keys: 'atomic', together: true }, 30)
    expect(m.paid).toBeGreaterThanOrEqual(4)
    expect(m.dupes).toBe(0)
  })

  it('applies messages twice without a key', () => {
    expect(auto({ ...AUTO, keys: 'none' }, 30).dupes).toBeGreaterThan(0)
  })
})
