import { describe, expect, it } from 'vitest'
import { Ledger } from './ledger'
import { Pacer } from './pacer'
import { Source, Worker } from './nodes'

function rig(rate: number) {
  const sim = new Ledger(() => 0.5)
  const src = sim.add(new Source('src'))
  src.minWork = src.maxWork = 1
  const pacer = sim.add(new Pacer('pacer'))
  pacer.rate = rate
  sim.add(new Worker('w', { slots: 50, queueLimit: 500, workPerRequest: 1 }))
  sim.link('src', 'pacer', 0)
  sim.link('pacer', 'w', 0)
  return { sim, src, pacer }
}

describe('pacer', () => {
  it('releases at its own pace and holds the rest', () => {
    const { sim, src, pacer } = rig(0.5)
    src.rate = 2
    for (let i = 0; i < 20; i++) sim.step()
    src.rate = 0
    expect(pacer.held.length).toBeGreaterThan(20)
    for (let i = 0; i < 100; i++) sim.step()
    expect(pacer.held).toHaveLength(0)
    expect(sim.done.src).toBe(40)
  })

  it('turns jobs away only when its buffer is full', () => {
    const { sim, src, pacer } = rig(0.1)
    pacer.capacity = 5
    src.rate = 3
    for (let i = 0; i < 10; i++) sim.step()
    expect(pacer.held).toHaveLength(5)
    expect(sim.lostAt.pacer).toBeGreaterThan(0)
  })

  it('lets jobs it does not apply to straight through', () => {
    const { sim, src, pacer } = rig(0.1)
    pacer.applies = () => false
    src.rate = 1
    for (let i = 0; i < 5; i++) sim.step()
    expect(pacer.held).toHaveLength(0)
    expect(sim.done.src).toBeGreaterThanOrEqual(3)
  })
})
