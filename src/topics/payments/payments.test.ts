import { describe, expect, it } from 'vitest'
import { Pay, SECOND, type Config } from './payments'

const rng = (seed: number) => () => {
  let t = (seed += 0x6d2b79f5)
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

const BASE: Config = {
  front: [],
  lane: [],
  key: 2,
  timeout: 3 * SECOND,
  tries: 3,
  crash: 0,
  dupes: 0,
  errRate: 0,
  lostRate: 0,
  phases: [{ from: 0, orders: 5 }],
  events: {},
}

function run(cfg: Partial<Config>, seconds = 20) {
  const pay = new Pay(rng(5), { ...BASE, ...cfg })
  for (let t = 0; t < seconds * SECOND; t++) pay.flow.step()
  return pay
}

describe('a calm checkout', () => {
  it('charges and saves every order once', () => {
    const pay = run({}, 30)
    expect(pay.doubles()).toBe(0)
    expect(pay.orphans()).toBe(0)
    expect(pay.failed()).toBe(0)
    expect(pay.savedCount()).toBeGreaterThan(100)
    expect(pay.late(5 * SECOND)).toBe(0)
  })
})

describe('double clicks', () => {
  it('charge twice with no store', () => {
    expect(run({ dupes: 0.5 }).doubles()).toBeGreaterThan(0)
  })
  it('charge twice when the key is new for every click', () => {
    const pay = run({ dupes: 0.5, key: 1, lane: [{ key: 'm1', kind: 'dedupe' }] })
    expect(pay.doubles()).toBeGreaterThan(0)
  })
  it('are stopped by a store with one key for the order', () => {
    const pay = run({ dupes: 0.5, lane: [{ key: 'm1', kind: 'dedupe' }] })
    expect(pay.doubles()).toBe(0)
    expect(pay.dedupe!.blocked).toBeGreaterThan(0)
  })
})

describe('a charge whose answer is lost', () => {
  const lost = { errRate: 0.1, lostRate: 0.2 }
  it('is charged again by a retry with a key for every try', () => {
    expect(run({ ...lost, key: 0, lane: [{ key: 'm1', kind: 'dedupe' }] }).doubles()).toBeGreaterThan(0)
  })
  it('is answered from the store when the key is the same', () => {
    const pay = run({ ...lost, key: 1, lane: [{ key: 'm1', kind: 'dedupe' }] })
    expect(pay.doubles()).toBe(0)
    expect(pay.orphans()).toBe(0)
  })
  it('turns the order away when nothing retries', () => {
    expect(run({ ...lost, tries: 1, lane: [{ key: 'm1', kind: 'dedupe' }] }).failed()).toBeGreaterThan(0)
  })
})

describe('a breaker', () => {
  const down = { events: { down: [2 * SECOND, 12 * SECOND] as [number, number] } }
  const road = [
    { key: 'm1', kind: 'breaker' as const },
    { key: 'm2', kind: 'dedupe' as const },
  ]
  it('opens on a dead provider and queues the orders until it is back', () => {
    const pay = run({ ...down, lane: road, queue: 'q1', timeout: SECOND }, 40)
    expect(pay.failed()).toBeLessThan(3)
    expect(pay.doubles()).toBe(0)
    expect(pay.waiting()).toBeLessThan(10)
    expect(pay.savedCount()).toBeGreaterThan(150)
  })
  it('turns shoppers away without a queue', () => {
    expect(run({ ...down, lane: road, timeout: SECOND }, 40).failed()).toBeGreaterThan(10)
  })
})

describe('a crash in the middle', () => {
  const crash = { events: { crash: { at: 10 * SECOND, down: 2 * SECOND } }, phases: [{ from: 0, orders: 14 }], lane: [{ key: 'm1', kind: 'dedupe' as const }] }
  it('leaves charges with no order when nothing is kept', () => {
    expect(run({ ...crash, crash: 0 }, 30).failed()).toBeGreaterThan(0)
  })
  it('is finished after the restart when the order was written down first', () => {
    const pay = run({ ...crash, crash: 1 }, 30)
    expect(pay.failed()).toBe(0)
    expect(pay.orphans()).toBe(0)
    expect(pay.doubles()).toBe(0)
  })
  it('is paid back by refunds, and the sale is lost', () => {
    const pay = run({ ...crash, crash: 2 }, 30)
    expect(pay.orphans()).toBe(0)
    expect(pay.failed()).toBeGreaterThan(0)
  })
})
