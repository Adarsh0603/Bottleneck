import { describe, expect, it } from 'vitest'
import { Ledger } from './ledger'
import { PriorityQueue } from './priority'
import { Provider } from './provider'
import { DeadLetters, DedupeStore, Sender } from './sender'
import { Source } from './nodes'

// source ──▶ sender ──▶ provider, with optional dedupe store and dead letters.
function rig({ dedupe = false, dead = false } = {}) {
  const sim = new Ledger(() => 0.5)
  const src = sim.add(new Source('src'))
  src.minWork = src.maxWork = 2
  const sender = sim.add(new Sender('sender', { slots: 2, queueLimit: 20, workPerRequest: 2 }))
  const provider = sim.add(new Provider('provider'))
  provider.latency = 4
  sender.timeout = 12
  sender.backoff = 5
  sim.link('src', 'sender', 0)
  if (dedupe) {
    const store = sim.add(new DedupeStore('dedupe'))
    provider.onSent = (job) => store.mark(job)
    sim.link('sender', 'dedupe', 0)
    sim.link('dedupe', 'provider', 0)
  } else sim.link('sender', 'provider', 0)
  if (dead) {
    sim.add(new DeadLetters('dead'))
    sim.link('sender', 'dead', 0)
  }
  const send = (n: number) => {
    src.rate = n
    sim.step()
    src.rate = 0
  }
  const run = (ticks: number) => {
    for (let i = 0; i < ticks; i++) sim.step()
  }
  return { sim, sender, provider, send, run }
}

describe('provider and sender', () => {
  it('sends a message once and answers it', () => {
    const { sim, provider, send, run } = rig()
    send(1)
    run(20)
    expect(sim.done.src).toBe(1)
    expect(provider.duplicates()).toBe(0)
    expect(provider.sent.size).toBe(1)
  })

  it('holds its slot while it waits for the provider', () => {
    const { sender, provider, send, run } = rig()
    provider.latency = 50
    send(2)
    run(10)
    expect(sender.active).toHaveLength(2)
    send(1)
    run(1)
    expect(sender.queue).toHaveLength(1)
  })

  it('retries a failed call, and gives up after max attempts', () => {
    const { sim, sender, provider, send, run } = rig()
    provider.failRate = 1
    send(1)
    run(120)
    expect(sender.retries).toBe(2)
    expect(provider.failed).toBe(3)
    expect(sim.lost.src).toBe(1)
    expect(sim.done.src).toBeUndefined()
  })

  it('waits longer before each retry', () => {
    const { sim, provider, send, run } = rig()
    provider.failRate = 1
    const calls: number[] = []
    const receive = provider.receive.bind(provider)
    provider.receive = (job, s) => {
      calls.push(s.tick)
      receive(job, s)
    }
    send(1)
    run(80)
    expect(calls).toHaveLength(3)
    expect(calls[2] - calls[1]).toBeGreaterThan(calls[1] - calls[0])
    expect(sim.stats.dropped).toBe(1)
  })

  it('keeps messages that ran out of retries in dead letters', () => {
    const { sim, provider, send, run } = rig({ dead: true })
    provider.down = true
    send(3)
    run(120)
    expect((sim.node('dead') as DeadLetters).jobs).toHaveLength(3)
    expect(sim.lost.src).toBeUndefined()
  })

  it('recovers when the outage ends before the retries run out', () => {
    const { sim, provider, send, run } = rig()
    provider.down = true
    send(1)
    run(8)
    provider.down = false
    run(80)
    expect(sim.done.src).toBe(1)
  })

  it('turns calls away past the rate limit', () => {
    const { provider, send, run } = rig()
    provider.limit = 1
    provider.window = 1000
    send(2)
    run(4)
    expect(provider.turnedAway).toBeGreaterThanOrEqual(1)
  })

  it('sends twice when the answer is lost and the call is retried', () => {
    const { sim, provider, send, run } = rig()
    provider.lostRate = 1
    send(1)
    run(4)
    provider.lostRate = 0
    run(80)
    expect(provider.duplicates()).toBe(1)
    expect(sim.done.src).toBe(1)
  })

  it('does not send twice behind a dedupe store', () => {
    const { sim, provider, send, run } = rig({ dedupe: true })
    provider.lostRate = 1
    send(1)
    run(4)
    provider.lostRate = 0
    run(80)
    expect(provider.duplicates()).toBe(0)
    expect(sim.done.src).toBe(1)
    expect((sim.node('dedupe') as DedupeStore).blocked).toBe(1)
  })

  it('counts an answer after its deadline as late', () => {
    const { sim, send, run } = rig()
    sim.deadline.src = 3
    send(1)
    run(20)
    expect(sim.late.src).toBe(1)
  })
})

describe('priority queue', () => {
  it('serves the urgent lane first and keeps lanes apart', () => {
    const sim = new Ledger(() => 0.5)
    const q = sim.add(new PriorityQueue('q', 2, 3))
    q.laneOf = (job) => (job.from === 'otp' ? 0 : 1)
    const w = sim.add(new Sender('w', { slots: 1, queueLimit: 10, workPerRequest: 1 }))
    q.prefetch = 0
    sim.link('q', 'w', 0)
    const bulk = Array.from({ length: 5 }, () => sim.newJob(1, undefined, 'bulk'))
    for (const j of bulk) sim.deliver(j, 'q')
    expect(q.lanes[1]).toHaveLength(3) // the lane is full: two were turned away
    expect(sim.lost.bulk).toBe(2)
    const otp = sim.newJob(1, undefined, 'otp')
    sim.deliver(otp, 'q')
    expect(q.lanes[0]).toHaveLength(1)
    q.process(sim)
    expect(w.queue[0]).toBe(otp)
  })
})
