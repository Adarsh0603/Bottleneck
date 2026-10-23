import { describe, expect, it } from 'vitest'
import { LoadBalancerSim } from './engine'

function sim(servers: number[], requestsPerTick = 1) {
  const s = new LoadBalancerSim({ requestsPerTick, minWork: 10, maxWork: 10 }, () => 0)
  for (const speed of servers) s.addServer(speed)
  return s
}

describe('round-robin', () => {
  it('cycles through alive servers in order', () => {
    const s = sim([1, 1, 1])
    const picks = Array.from({ length: 6 }, () => s.pickServer()!.name)
    expect(picks).toEqual([
      'Server A', 'Server B', 'Server C',
      'Server A', 'Server B', 'Server C',
    ])
  })

  it('skips dead servers', () => {
    const s = sim([1, 1, 1])
    s.setAlive(1, false)
    const picks = Array.from({ length: 4 }, () => s.pickServer()!.name)
    expect(picks).not.toContain('Server B')
  })
})

describe('direct (no load balancer)', () => {
  it('sends everything to the first server', () => {
    const s = sim([1, 1, 1])
    s.algorithm = 'direct'
    const picks = Array.from({ length: 3 }, () => s.pickServer()!.name)
    expect(picks).toEqual(['Server A', 'Server A', 'Server A'])
  })

  it('fails when the first server is down, even if others are up', () => {
    const s = sim([1, 1])
    s.algorithm = 'direct'
    s.setAlive(0, false)
    expect(s.pickServer()).toBeUndefined()
  })
})

describe('least-connections', () => {
  it('picks the server with the fewest pending requests', () => {
    const s = sim([1, 1])
    s.algorithm = 'least-connections'
    s.servers[0].queue.push({ id: 99, work: 10, remaining: 10, createdAt: 0 })
    expect(s.pickServer()!.name).toBe('Server B')
  })

  it('counts requests still in transit', () => {
    const s = sim([1, 1])
    s.algorithm = 'least-connections'
    s.step() // one request now travelling to some server
    const target = s.inTransit[0].serverId
    expect(s.pickServer()!.id).not.toBe(target)
  })

  it('beats round-robin when one server is slow', () => {
    const run = (algorithm: 'round-robin' | 'least-connections') => {
      const s = new LoadBalancerSim({ requestsPerTick: 0.6, minWork: 20, maxWork: 20 }, () => 0)
      s.algorithm = algorithm
      s.addServer(1)
      s.addServer(1)
      s.addServer(0.25)
      for (let i = 0; i < 2000; i++) s.step()
      return s.stats.dropped
    }
    expect(run('least-connections')).toBeLessThan(run('round-robin'))
  })
})

describe('failures', () => {
  it('drops everything a server held when it dies', () => {
    const s = sim([1])
    for (let i = 0; i < 20; i++) s.step()
    const held = s.servers[0].active.length + s.servers[0].queue.length + s.inTransit.length
    expect(held).toBeGreaterThan(0)
    s.setAlive(0, false)
    expect(s.stats.dropped).toBe(held)
    expect(s.inTransit).toHaveLength(0)
  })

  it('drops new requests when no server is alive', () => {
    const s = sim([1], 1)
    s.setAlive(0, false)
    for (let i = 0; i < 5; i++) s.step()
    expect(s.stats.dropped).toBe(5)
  })

  it('drops requests when the queue is full', () => {
    const s = new LoadBalancerSim({ requestsPerTick: 5, queueLimit: 2, transitTicks: 1 }, () => 0)
    s.addServer(1, 1)
    for (let i = 0; i < 10; i++) s.step()
    expect(s.stats.dropped).toBeGreaterThan(0)
  })
})

describe('processing', () => {
  it('completes a job after work / speed ticks and records latency', () => {
    const s = new LoadBalancerSim({ requestsPerTick: 1, minWork: 10, maxWork: 10, transitTicks: 1 }, () => 0)
    s.addServer(2)
    s.step() // spawn + arrive in queue + start processing (10 -> 8)
    s.config.requestsPerTick = 0
    for (let i = 0; i < 4; i++) s.step()
    expect(s.stats.completed).toBe(1)
    expect(s.stats.latencies[0]).toBe(4)
  })
})
