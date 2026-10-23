// The load-balancing system, built on the shared flow engine:
//
//   users ──▶ load balancer ──▶ server A
//                         ├──▶ server B
//                         └──▶ ...
//
// Requests arrive at a steady rate, the balancer picks a server for each one
// the moment it arrives, and the request travels there, waits in that
// server's queue, then takes a worker slot until its work is done. Slow
// servers burn through work more slowly, so an algorithm that ignores load
// piles requests up on them.
//
// This class keeps the load-balancing view of things (servers by number,
// requests in flight to a server, drops by server) on top of the general
// node-and-link simulation in core/flow.

import { FlowSim, type Job, type Stats } from '../../core/flow/engine'
import { Router, Source, Worker, type Algorithm } from '../../core/flow/nodes'

export type { Algorithm, Job, Stats }

export interface Transit {
  job: Job
  serverId: number
  progress: number
}

export interface SimConfig {
  requestsPerTick: number
  minWork: number
  maxWork: number
  queueLimit: number
  transitTicks: number
}

// A request that was turned away. serverId is missing when no server could
// take it at all. Kept briefly so views can animate the failure.
export interface Drop {
  jobId: number
  serverId?: number
  tick: number
}

export const DEFAULT_CONFIG: SimConfig = {
  requestsPerTick: 0.5,
  minWork: 10,
  maxWork: 40,
  queueLimit: 8,
  transitTicks: 10,
}

const SERVER_NAMES = 'ABCDEFGHIJKLMNOP'
const USERS = 'users'
const BALANCER = 'balancer'

export class Server extends Worker {
  readonly id: number
  readonly name: string

  constructor(id: number, speed: number, slots: number) {
    super(`server-${id}`, { speed, slots })
    this.id = id
    this.name = `Server ${SERVER_NAMES[id % SERVER_NAMES.length]}`
  }
}

export class LoadBalancerSim {
  config: SimConfig
  servers: Server[] = []
  readonly flow: FlowSim

  private users: Source
  private balancer: Router
  private byKey = new Map<string, Server>()
  // Server number for every node that was ever a server, so drops still name
  // their server after it's been removed.
  private serverIds = new Map<string, number>()
  private nextServerId = 0

  constructor(config: Partial<SimConfig> = {}, rng: () => number = Math.random) {
    this.config = { ...DEFAULT_CONFIG, ...config }
    this.flow = new FlowSim(rng)
    this.users = this.flow.add(new Source(USERS))
    this.balancer = this.flow.add(new Router(BALANCER))
    this.flow.link(USERS, BALANCER, 0)
  }

  get tick() {
    return this.flow.tick
  }

  get stats() {
    return this.flow.stats
  }

  get algorithm(): Algorithm {
    return this.balancer.algorithm
  }

  set algorithm(algorithm: Algorithm) {
    this.balancer.algorithm = algorithm
  }

  // Requests on their way to a server.
  get inTransit(): Transit[] {
    return this.flow.inTransit.flatMap((t) => {
      const server = this.byKey.get(t.to)
      return server ? [{ job: t.job, serverId: server.id, progress: t.progress }] : []
    })
  }

  get recentDrops(): Drop[] {
    return this.flow.recentDrops.map((d) => ({ jobId: d.jobId, serverId: this.serverIds.get(d.node), tick: d.tick }))
  }

  addServer(speed = 1, slots = 4): Server {
    const server = new Server(this.nextServerId++, speed, slots)
    server.queueLimit = this.config.queueLimit
    this.servers.push(server)
    this.byKey.set(server.key, server)
    this.serverIds.set(server.key, server.id)
    this.flow.add(server)
    this.flow.link(BALANCER, server.key, this.config.transitTicks)
    return server
  }

  removeServer(id: number) {
    const server = this.servers.find((s) => s.id === id)
    if (!server) return
    this.flow.remove(server.key)
    this.byKey.delete(server.key)
    this.servers = this.servers.filter((s) => s.id !== id)
  }

  // A crashed server loses everything it was holding. The load balancer stops
  // routing to it immediately (we assume instant health checks).
  setAlive(id: number, alive: boolean) {
    const server = this.servers.find((s) => s.id === id)
    if (!server || server.alive === alive) return
    if (!alive) this.flow.fail(server.key)
    server.alive = alive
  }

  load(server: Server): number {
    return server.load()
  }

  pickServer(): Server | undefined {
    const target = this.balancer.pick(this.flow)
    return target ? this.byKey.get(target.key) : undefined
  }

  step() {
    // Settings can change between ticks (sliders, tests), so apply them first.
    this.users.rate = this.config.requestsPerTick
    this.users.minWork = this.config.minWork
    this.users.maxWork = this.config.maxWork
    for (const server of this.servers) {
      server.queueLimit = this.config.queueLimit
      this.flow.link(BALANCER, server.key, this.config.transitTicks)
    }
    // A new travel time applies to requests already on their way, too.
    for (const t of this.flow.inTransit) t.ticks = this.config.transitTicks
    this.flow.step()
  }

  avgLatency(): number {
    return this.flow.avgLatency()
  }

  percentileLatency(p: number): number {
    return this.flow.percentileLatency(p)
  }
}
