// Tick-based load balancer simulation. Pure TypeScript, no React.
//
// Model: requests arrive at a steady rate, travel through the load balancer
// to a server, wait in that server's queue, then occupy one of its worker
// slots until their work is done. Slow servers burn through work more slowly,
// so a routing algorithm that ignores load will pile requests up on them.

// 'direct' means there is no load balancer: clients only know the address of
// the first server, so every request goes there.
export type Algorithm = 'direct' | 'round-robin' | 'random' | 'least-connections' | 'power-of-two'

export interface Job {
  id: number
  work: number
  remaining: number
  createdAt: number
}

export interface Server {
  id: number
  name: string
  speed: number
  slots: number
  alive: boolean
  active: Job[]
  queue: Job[]
  served: number
}

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

export interface Stats {
  completed: number
  dropped: number
  latencies: number[]
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

const LATENCY_WINDOW = 200
const DROP_MEMORY_TICKS = 40
const SERVER_NAMES = 'ABCDEFGHIJKLMNOP'

export class LoadBalancerSim {
  tick = 0
  algorithm: Algorithm = 'round-robin'
  config: SimConfig
  servers: Server[] = []
  inTransit: Transit[] = []
  stats: Stats = { completed: 0, dropped: 0, latencies: [] }
  recentDrops: Drop[] = []

  private rng: () => number
  private rrIndex = 0
  private nextJobId = 0
  private nextServerId = 0
  private arrivalCarry = 0

  constructor(config: Partial<SimConfig> = {}, rng: () => number = Math.random) {
    this.config = { ...DEFAULT_CONFIG, ...config }
    this.rng = rng
  }

  addServer(speed = 1, slots = 4): Server {
    const id = this.nextServerId++
    const server: Server = {
      id,
      name: `Server ${SERVER_NAMES[id % SERVER_NAMES.length]}`,
      speed,
      slots,
      alive: true,
      active: [],
      queue: [],
      served: 0,
    }
    this.servers.push(server)
    return server
  }

  removeServer(id: number) {
    const server = this.servers.find((s) => s.id === id)
    if (!server) return
    this.failServer(server)
    this.servers = this.servers.filter((s) => s.id !== id)
  }

  // A crashed server loses everything it was holding. The load balancer stops
  // routing to it immediately (we assume instant health checks).
  setAlive(id: number, alive: boolean) {
    const server = this.servers.find((s) => s.id === id)
    if (!server || server.alive === alive) return
    if (!alive) this.failServer(server)
    server.alive = alive
  }

  load(server: Server): number {
    return server.active.length + server.queue.length
  }

  pickServer(): Server | undefined {
    if (this.algorithm === 'direct') {
      const first = this.servers[0]
      return first?.alive ? first : undefined
    }

    const alive = this.servers.filter((s) => s.alive)
    if (alive.length === 0) return undefined

    switch (this.algorithm) {
      case 'round-robin': {
        const server = alive[this.rrIndex % alive.length]
        this.rrIndex = (this.rrIndex + 1) % alive.length
        return server
      }
      case 'random':
        return alive[Math.floor(this.rng() * alive.length)]
      case 'least-connections':
        return alive.reduce((best, s) => (this.pending(s) < this.pending(best) ? s : best))
      case 'power-of-two': {
        // Sample two different servers and keep the less busy one.
        if (alive.length === 1) return alive[0]
        const i = Math.floor(this.rng() * alive.length)
        let j = Math.floor(this.rng() * (alive.length - 1))
        if (j >= i) j++
        return this.pending(alive[j]) < this.pending(alive[i]) ? alive[j] : alive[i]
      }
    }
  }

  // Count requests already on their way too, otherwise a burst all lands on
  // the same "empty" server before any of it arrives.
  private pending(server: Server): number {
    return this.load(server) + this.inTransit.filter((t) => t.serverId === server.id).length
  }

  step() {
    this.tick++
    this.recentDrops = this.recentDrops.filter((d) => this.tick - d.tick <= DROP_MEMORY_TICKS)
    this.spawnArrivals()
    this.advanceTransit()
    for (const server of this.servers) {
      if (server.alive) this.process(server)
    }
  }

  avgLatency(): number {
    const l = this.stats.latencies
    return l.length === 0 ? 0 : l.reduce((a, b) => a + b, 0) / l.length
  }

  percentileLatency(p: number): number {
    const sorted = [...this.stats.latencies].sort((a, b) => a - b)
    if (sorted.length === 0) return 0
    const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)
    return sorted[Math.max(0, idx)]
  }

  private spawnArrivals() {
    this.arrivalCarry += this.config.requestsPerTick
    while (this.arrivalCarry >= 1) {
      this.arrivalCarry -= 1
      const { minWork, maxWork } = this.config
      const work = minWork + Math.floor(this.rng() * (maxWork - minWork + 1))
      const job: Job = { id: this.nextJobId++, work, remaining: work, createdAt: this.tick }
      const server = this.pickServer()
      if (!server) {
        this.drop(job.id)
        continue
      }
      this.inTransit.push({ job, serverId: server.id, progress: 0 })
    }
  }

  private advanceTransit() {
    const stillMoving: Transit[] = []
    for (const t of this.inTransit) {
      t.progress += 1 / this.config.transitTicks
      if (t.progress < 1) {
        stillMoving.push(t)
        continue
      }
      const server = this.servers.find((s) => s.id === t.serverId)
      if (!server || !server.alive || server.queue.length >= this.config.queueLimit) {
        this.drop(t.job.id, t.serverId)
      } else {
        server.queue.push(t.job)
      }
    }
    this.inTransit = stillMoving
  }

  private process(server: Server) {
    while (server.active.length < server.slots && server.queue.length > 0) {
      server.active.push(server.queue.shift()!)
    }
    const stillWorking: Job[] = []
    for (const job of server.active) {
      job.remaining -= server.speed
      if (job.remaining > 0) {
        stillWorking.push(job)
        continue
      }
      server.served++
      this.stats.completed++
      this.stats.latencies.push(this.tick - job.createdAt)
      if (this.stats.latencies.length > LATENCY_WINDOW) this.stats.latencies.shift()
    }
    server.active = stillWorking
  }

  private drop(jobId: number, serverId?: number) {
    this.stats.dropped++
    this.recentDrops.push({ jobId, serverId, tick: this.tick })
  }

  private failServer(server: Server) {
    const lost = [
      ...server.active,
      ...server.queue,
      ...this.inTransit.filter((t) => t.serverId === server.id).map((t) => t.job),
    ]
    for (const job of lost) this.drop(job.id, server.id)
    server.active = []
    server.queue = []
    this.inTransit = this.inTransit.filter((t) => t.serverId !== server.id)
  }
}
