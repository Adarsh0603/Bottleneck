import { describe, expect, it } from 'vitest'
import { FlowSim } from './engine'
import { Router, Source, Worker } from './nodes'

// users ──(ticks)──▶ app ──(ticks)──▶ db
function chain(linkTicks: number) {
  const sim = new FlowSim(() => 0)
  const users = sim.add(new Source('users'))
  users.rate = 1
  users.minWork = 4
  users.maxWork = 4
  const app = sim.add(new Worker('app', { speed: 1 }))
  const db = sim.add(new Worker('db', { speed: 2 }))
  sim.link('users', 'app', linkTicks)
  sim.link('app', 'db', linkTicks)
  return { sim, users, app, db }
}

describe('flow engine', () => {
  it('passes a finished request on to the next node before answering it', () => {
    const { sim, users, app, db } = chain(1)
    sim.step() // emitted, travels 1 tick, queued at app, work 4 → 3
    users.rate = 0
    for (let i = 0; i < 3; i++) sim.step() // app finishes on tick 4, sends to db
    expect(app.served).toBe(1)
    expect(sim.stats.completed).toBe(0)
    sim.step() // arrives at db, 4 → 2
    sim.step() // db finishes
    expect(db.served).toBe(1)
    expect(sim.stats.completed).toBe(1)
    expect(sim.stats.latencies).toEqual([5])
  })

  it('delivers over a zero-tick link in the same tick', () => {
    const { sim, app } = chain(0)
    sim.step()
    expect(sim.inTransit).toHaveLength(0)
    expect(app.load()).toBe(1)
  })

  it('counts requests on their way to a node as pending there', () => {
    const { sim, app } = chain(5)
    sim.step()
    sim.step()
    expect(app.load()).toBe(0)
    expect(sim.pending(app)).toBe(2)
  })

  it('uses a node’s fixed cost per request when it has one', () => {
    const { sim, users, db } = chain(0)
    db.workPerRequest = 10
    sim.step()
    users.rate = 0
    for (let i = 0; i < 3; i++) sim.step() // app done on tick 4; db starts 10 → 8
    expect(db.active[0].remaining).toBe(8)
  })

  it('drops at the router when no target is alive', () => {
    const sim = new FlowSim(() => 0)
    const router = sim.add(new Router('lb'))
    const server = sim.add(new Worker('s'))
    sim.link('lb', 's', 1)
    server.alive = false
    sim.deliver(sim.newJob(5), 'lb')
    expect(sim.recentDrops).toEqual([{ jobId: 0, node: 'lb', tick: 0 }])
    expect(router.pick(sim)).toBeUndefined()
  })

  it('removing a node drops what it held and what was on its way, and unlinks it', () => {
    const { sim, app } = chain(3)
    for (let i = 0; i < 6; i++) sim.step()
    const held = app.load() + sim.inTransit.filter((t) => t.to === 'app').length
    expect(held).toBeGreaterThan(0)
    sim.remove('app')
    expect(sim.stats.dropped).toBe(held)
    expect(sim.targets('users')).toHaveLength(0)
    expect(sim.node('app')).toBeUndefined()
  })
})
