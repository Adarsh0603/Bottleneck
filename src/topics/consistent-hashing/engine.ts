// Consistent hashing, on the shared flow engine:
//
//                         ┌──▶ cache server ─┐
//   users ──▶ app servers ┼──▶ cache server ─┼──▶ answered
//                         └──▶ database ◀────┘ (items not cached yet)
//
// 60 popular items are spread over the cache servers (see ring.ts). The app
// sends each request to its item's server. If that server hasn't got the item
// yet (it just moved there), the request goes to the database instead, which
// is slow, and fills the server for next time. Changing the servers moves
// some items, and every moved item is a trip to the database.

import { FlowSim, type FlowNode, type Job } from '../../core/flow/engine'
import { Worker } from '../../core/flow/nodes'
import { Assigner, KEY_COUNT, MAX_NODES } from './ring'
import type { ConsistentState } from './types'
import { ALL_NODES, nodeKey, TICKS_PER_SECOND } from './world'

export const LINK_TICKS = { usersApp: 8, appNode: 6 }
export const NODE_SLOTS = 4
export const NODE_WORK = 10
export const DB_SLOTS = 3
export const DB_WORK = 14
const WINDOW = TICKS_PER_SECOND * 5

class Users implements FlowNode {
  alive = true
  rate = 0 // requests per tick
  readonly key = 'users'
  private carry = 0

  receive(job: Job, sim: FlowSim) {
    sim.complete(job)
  }

  emit(sim: FlowSim) {
    this.carry += this.rate
    while (this.carry >= 1) {
      this.carry -= 1
      sim.forward(sim.newJob(1, Math.floor(sim.rng() * KEY_COUNT), this.key), this.key, 'app')
    }
  }
}

// The app servers: send the request to its item's cache server, or to the
// database when that server hasn't got the item yet.
class App implements FlowNode {
  alive = true
  readonly key = 'app'
  private assigner: Assigner

  constructor(assigner: Assigner) {
    this.assigner = assigner
  }

  receive(job: Job, flow: FlowSim) {
    const k = job.key ?? 0
    const owner = this.assigner.owner[k]
    if (owner < 0) return flow.forward(job, this.key, 'db')
    flow.forward(job, this.key, this.assigner.warm[k] ? nodeKey(owner) : 'db')
  }
}

export interface ConsistentMetrics {
  rps: number
  load: Record<string, number> // how busy each server's slots were, 0–1
  maxLoad: number // the busiest server in use
  minLoad: number // the quietest server in use
  dbLoad: number
  errorRate: number // percent of requests turned away
  moved: number // share of items the last change moved, 0–1
}

interface Sample {
  completed: number
  dropped: number
  busy: Record<string, number>
}

export class ConsistentSim {
  readonly flow: FlowSim
  readonly assigner = new Assigner()
  readonly servers: Worker[] = []
  readonly db: Worker
  alive: number[] = []
  down: number | null = null
  nodes = 0
  ring = false

  private users: Users
  private changedAt = 0
  private busy: Record<string, number> = {}
  private history: Sample[] = []

  constructor(rng: () => number = Math.random) {
    this.flow = new FlowSim(rng)
    this.users = this.flow.add(new Users())
    this.flow.add(new App(this.assigner))
    this.flow.link('users', 'app', LINK_TICKS.usersApp)
    for (let i = 0; i < MAX_NODES; i++) {
      const s = this.flow.add(new Worker(nodeKey(i), { slots: NODE_SLOTS, queueLimit: 8, workPerRequest: NODE_WORK }))
      this.flow.link('app', s.key, LINK_TICKS.appNode)
      this.busy[s.key] = 0
      this.servers.push(s)
    }
    this.db = this.flow.add(new Worker('db', { slots: DB_SLOTS, queueLimit: 8, workPerRequest: DB_WORK }))
    this.flow.link('app', 'db', LINK_TICKS.appNode)
    this.busy.db = 0
    // The database's answer fills the item into its server, so next time is a hit.
    this.db.onFinish = (job) => {
      const k = job.key ?? 0
      if (this.assigner.owner[k] >= 0) this.assigner.warm[k] = true
    }
  }

  get tick() {
    return this.flow.tick
  }

  // The stats cover only time since the servers last changed.
  get settled() {
    return this.flow.tick - this.changedAt >= WINDOW
  }

  apply(st: ConsistentState) {
    this.users.rate = st.rps / TICKS_PER_SECOND
    this.nodes = st.nodes
    this.ring = st.mode === 'ring'
    this.alive = ALL_NODES.slice(0, st.nodes).filter((i) => i !== st.down)
    if (this.assigner.update(this.alive, st.mode, st.points)) this.changedAt = this.flow.tick
    if (st.down !== this.down) {
      if (this.down !== null) this.servers[this.down].alive = true
      this.down = st.down
      if (st.down !== null) {
        this.servers[st.down].alive = false
        this.flow.fail(nodeKey(st.down))
      }
    }
  }

  step() {
    this.flow.step()
    for (const s of [...this.servers, this.db]) this.busy[s.key] += s.active.length / s.slots
    this.history.push({
      completed: this.flow.stats.completed,
      dropped: this.flow.stats.dropped,
      busy: { ...this.busy },
    })
    if (this.history.length > WINDOW + 1) this.history.shift()
  }

  get metrics(): ConsistentMetrics {
    const keys = Object.keys(this.busy)
    const load = Object.fromEntries(keys.map((k) => [k, 0]))
    const h = this.history
    const span = h.length - 1
    const moved = this.assigner.moved
    if (span <= 0) return { rps: 0, load, maxLoad: 0, minLoad: 0, dbLoad: 0, errorRate: 0, moved }
    const a = h[0]
    const b = h[span]
    for (const k of keys) load[k] = (b.busy[k] - a.busy[k]) / span
    const used = this.alive.map((i) => load[nodeKey(i)])
    const done = b.completed - a.completed
    const dropped = b.dropped - a.dropped
    return {
      rps: ((b.completed + b.dropped - a.completed - a.dropped) * TICKS_PER_SECOND) / span,
      load,
      maxLoad: used.length ? Math.max(...used) : 0,
      minLoad: used.length ? Math.min(...used) : 0,
      dbLoad: load.db,
      errorRate: done + dropped === 0 ? 0 : (dropped / (done + dropped)) * 100,
      moved,
    }
  }
}
