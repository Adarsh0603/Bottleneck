import { describe, expect, it } from 'vitest'
import { CLIP, RUNGS, StreamSim } from './engine'
import type { StreamState } from './types'

const BASE: StreamState = { watch: 0, round: 0, mode: 'abr', rung: 3, rule: 'throughput', calm: false, start: 'low', net: 'steady' }

const watch = (over: Partial<StreamState>) => {
  const sim = new StreamSim()
  sim.apply({ ...BASE, ...over })
  for (let i = 0; i < 20 * CLIP && !sim.metrics.done; i++) sim.step()
  return sim.metrics
}

describe('adaptive streaming engine', () => {
  it('one 1080p file freezes on a 3 Mbps connection and plays on a 10 Mbps one', () => {
    expect(watch({ mode: 'file', rung: 3, net: 'steady' }).stalls).toBeGreaterThan(5)
    expect(watch({ mode: 'file', rung: 3, net: 'fast' }).stalls).toBe(0)
  })

  it('fixed pieces freeze when their quality needs more than the connection gives', () => {
    expect(watch({ mode: 'segments', rung: 3, net: 'steady' }).stalls).toBeGreaterThan(0)
    expect(watch({ mode: 'segments', rung: 1, net: 'steady' }).stalls).toBe(0)
  })

  it('a quality that needs more than the connection gives never plays smoothly', () => {
    const slow = watch({ mode: 'segments', rung: 2, net: 'slow' })
    expect(slow.stalled).toBeGreaterThan(60)
  })

  it('the ladder settles on the rung the connection can carry', () => {
    const m = watch({ net: 'slow' })
    expect(m.stalls).toBe(0)
    expect(m.average).toBeLessThan(RUNGS[1].mbps)
  })

  it('the speed rule jumps around on a steady connection and calm does not', () => {
    const jumpy = watch({ net: 'steady' })
    const calm = watch({ net: 'steady', calm: true })
    expect(jumpy.switches).toBeGreaterThan(10)
    expect(calm.switches).toBeLessThanOrEqual(4)
    expect(calm.stalls).toBe(0)
  })

  it('a long drop freezes the speed rule but not the buffer rule', () => {
    expect(watch({ net: 'dip', rule: 'throughput' }).stalls).toBeGreaterThan(0)
    expect(watch({ net: 'dip', rule: 'buffer' }).stalls).toBe(0)
  })

  it('a tunnel freezes the buffer rule but not the speed rule', () => {
    expect(watch({ net: 'tunnel', rule: 'buffer' }).stalls).toBeGreaterThan(0)
    expect(watch({ net: 'tunnel', rule: 'throughput' }).stalls).toBe(0)
  })

  it('starting at 1080p on a slow connection waits far longer than starting at 240p', () => {
    expect(watch({ net: 'slow', start: 'high' }).start).toBeGreaterThan(20)
    expect(watch({ net: 'slow', start: 'low' }).start).toBeLessThan(3)
  })

  it('watching again starts the clip over', () => {
    const sim = new StreamSim()
    sim.apply(BASE)
    for (let i = 0; i < 200; i++) sim.step()
    expect(sim.metrics.average).toBeGreaterThan(0)
    sim.apply({ ...BASE, watch: 1 })
    expect(sim.metrics.average).toBe(0)
    expect(sim.playhead).toBe(0)
  })
})
