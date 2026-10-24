import { describe, expect, it } from 'vitest'
import { TransactionsSim } from './engine'
import type { TransactionsState } from './types'
import { TICKS_PER_SECOND } from './world'

const BASE: TransactionsState = { tap: 0, pace: 0, batch: 1, mode: 'naive', fail: 'none', crash: false, log: false, keys: false }

function order(st: Partial<TransactionsState>, seconds = 20, taps = 1) {
  const sim = new TransactionsSim()
  const base = { ...BASE, ...st }
  sim.apply(base)
  for (let i = 1; i <= taps; i++) {
    sim.apply({ ...base, tap: i })
    for (let t = 0; t < TICKS_PER_SECOND * 2; t++) sim.step()
  }
  for (let t = 0; t < TICKS_PER_SECOND * seconds; t++) sim.step()
  return sim
}

describe('transactions: nothing goes wrong', () => {
  it.each(['naive', '2pc', 'saga'] as const)('%s commits one order', (mode) => {
    expect(order({ mode }).metrics).toMatchObject({ orders: 1, committed: 1, broken: 0, aborted: 0, running: 0 })
  })
})

describe('transactions: Shipping refuses', () => {
  it('naive leaves the order half done', () => {
    expect(order({ fail: 'ship' }).metrics).toMatchObject({ broken: 1, committed: 0 })
  })

  it('naive is fine when the first service refuses', () => {
    expect(order({ fail: 'stock' }).metrics).toMatchObject({ aborted: 1, broken: 0 })
  })

  it('2pc aborts cleanly and frees every lock', () => {
    const m = order({ mode: '2pc', fail: 'ship' }).metrics
    expect(m).toMatchObject({ aborted: 1, broken: 0, locked: 0 })
  })

  it('saga undoes the finished steps', () => {
    const m = order({ mode: 'saga', fail: 'ship' }).metrics
    expect(m).toMatchObject({ aborted: 1, broken: 0, undone: 2 })
  })

  it('saga undoes only what was done', () => {
    expect(order({ mode: 'saga', fail: 'pay' }).metrics).toMatchObject({ aborted: 1, undone: 1 })
    expect(order({ mode: 'saga', fail: 'stock' }).metrics).toMatchObject({ aborted: 1, undone: 0 })
  })

  it('saga undoes the last step first', () => {
    const sim = new TransactionsSim()
    sim.apply({ ...BASE, mode: 'saga', fail: 'ship', tap: 1 })
    const seen: number[] = []
    for (let t = 0; t < TICKS_PER_SECOND * 20; t++) {
      sim.step()
      for (const m of sim.msgs) if (m.kind === 'undo' && !seen.includes(m.part)) seen.push(m.part)
    }
    expect(seen).toEqual([1, 0])
  })
})

describe('transactions: locks', () => {
  it('2pc makes a second order wait', () => {
    const sim = new TransactionsSim()
    sim.apply({ ...BASE, mode: '2pc', tap: 2 })
    for (let t = 0; t < TICKS_PER_SECOND * 20; t++) sim.step()
    expect(sim.metrics).toMatchObject({ committed: 2, stalls: 3, locked: 0, stalled: 0 })
  })

  it('a saga never waits', () => {
    const sim = new TransactionsSim()
    sim.apply({ ...BASE, mode: 'saga', tap: 2 })
    for (let t = 0; t < TICKS_PER_SECOND * 20; t++) sim.step()
    expect(sim.metrics).toMatchObject({ committed: 2, stalls: 0 })
  })
})

describe('transactions: Orders crashes', () => {
  it('2pc holds every lock until Orders is back, then aborts', () => {
    const sim = new TransactionsSim()
    sim.apply({ ...BASE, mode: '2pc', crash: true, tap: 1 })
    for (let t = 0; t < TICKS_PER_SECOND * 3; t++) sim.step()
    expect(sim.metrics).toMatchObject({ locked: 3, crashes: 1, running: 1 })
    for (let t = 0; t < TICKS_PER_SECOND * 15; t++) sim.step()
    expect(sim.metrics).toMatchObject({ locked: 0, aborted: 1, broken: 0 })
  })

  it('a naive order is left half done', () => {
    expect(order({ crash: true }).metrics).toMatchObject({ broken: 1, crashes: 1 })
  })

  it('a saga with no log is left half done', () => {
    expect(order({ mode: 'saga', crash: true }).metrics).toMatchObject({ broken: 1, committed: 0 })
  })

  it('a saga with a log carries on', () => {
    expect(order({ mode: 'saga', crash: true, log: true }).metrics).toMatchObject({ committed: 1, broken: 0, crashes: 1 })
  })

  it('a saga with a log still undoes if Shipping then refuses', () => {
    expect(order({ mode: 'saga', crash: true, log: true, fail: 'ship' }).metrics).toMatchObject({ aborted: 1, broken: 0, undone: 2 })
  })

  it('crashes every other order', () => {
    expect(order({ mode: 'saga', crash: true, log: true }, 20, 4).metrics).toMatchObject({ committed: 4, crashes: 2, broken: 0 })
  })
})

describe('transactions: repeated steps', () => {
  it('a saga that asks again makes Shipping do the step twice', () => {
    expect(order({ mode: 'saga', crash: true, log: true }).metrics).toMatchObject({ committed: 1, doubles: 1 })
  })

  it('keys make the repeat harmless', () => {
    expect(order({ mode: 'saga', crash: true, log: true, keys: true }).metrics).toMatchObject({ committed: 1, doubles: 0 })
  })
})
