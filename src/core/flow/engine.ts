// A general request-flow simulation: nodes connected by links, with requests
// (jobs) moving between them one tick at a time. Pure TypeScript, no React.
//
// Each tick runs in three phases, always in this order:
//   1. sources emit new requests; zero-delay nodes (like a router) pass them
//      on immediately
//   2. requests in flight move along their links; arrivals are delivered
//   3. nodes do their work (servers process, and so on)
//
// Topics build their systems from node types (see nodes.ts) and add new
// types as they need them: caches, queues, rate limiters, ...

export interface Job {
  id: number
  work: number
  remaining: number
  createdAt: number
  key?: number // what is being asked for, e.g. a cache key
  from?: string // the source that sent it, e.g. a user region
  msg?: number // what the message is, kept across retries (a new job gets its own id)
  attempts?: number // how many times it has been sent to a provider
  caller?: string // the node waiting for an answer to a call in flight
  via?: string // the provider it is meant for
}

export interface Transit {
  job: Job
  from: string
  to: string
  progress: number // 0 → 1 along the link
  ticks: number // how long the trip takes
}

export interface Drop {
  jobId: number
  node: string // where it was turned away
  tick: number
}

export interface Stats {
  completed: number
  dropped: number
  latencies: number[] // most recent completions, in ticks
}

export interface FlowNode {
  key: string
  alive: boolean
  // A request arrives. The node keeps it, passes it on, completes or drops it.
  receive(job: Job, sim: FlowSim): void
  // Phase 1: create new requests (sources only).
  emit?(sim: FlowSim): void
  // Phase 3: do this tick's work.
  process?(sim: FlowSim): void
  // Requests the node currently holds.
  load?(): number
  // The node crashed or was removed: give up everything it holds.
  lose?(): Job[]
}

interface Link {
  to: string
  ticks: number
}

const LATENCY_WINDOW = 200
const DROP_MEMORY_TICKS = 40

export class FlowSim {
  tick = 0
  inTransit: Transit[] = []
  stats: Stats = { completed: 0, dropped: 0, latencies: [] }
  recentDrops: Drop[] = []
  readonly rng: () => number
  // Called as each request is answered, e.g. to track response time per region.
  onComplete?: (job: Job, latencyTicks: number) => void

  private nodes = new Map<string, FlowNode>()
  private links = new Map<string, Link[]>()
  private nextJobId = 0

  constructor(rng: () => number = Math.random) {
    this.rng = rng
  }

  // --- Building the system ---------------------------------------------------

  add<T extends FlowNode>(node: T): T {
    this.nodes.set(node.key, node)
    return node
  }

  node(key: string): FlowNode | undefined {
    return this.nodes.get(key)
  }

  all(): FlowNode[] {
    return [...this.nodes.values()]
  }

  // Remove a node, dropping everything it held or that was on its way to it.
  remove(key: string) {
    if (!this.nodes.has(key)) return
    this.fail(key)
    this.nodes.delete(key)
    this.links.delete(key)
    for (const [from, list] of this.links) this.links.set(from, list.filter((l) => l.to !== key))
  }

  link(from: string, to: string, ticks: number) {
    const list = this.links.get(from) ?? []
    const existing = list.find((l) => l.to === to)
    if (existing) existing.ticks = ticks
    else list.push({ to, ticks })
    this.links.set(from, list)
  }

  unlink(from: string, to: string) {
    const list = this.links.get(from)
    if (list) this.links.set(from, list.filter((l) => l.to !== to))
  }

  // Where a node can send requests, in the order the links were made.
  targets(from: string): FlowNode[] {
    return (this.links.get(from) ?? []).map((l) => this.nodes.get(l.to)).filter((n): n is FlowNode => !!n)
  }

  // --- Moving requests ---------------------------------------------------------

  newJob(work: number, key?: number, from?: string): Job {
    const id = this.nextJobId++
    return { id, work, remaining: work, createdAt: this.tick, key, from, msg: id }
  }

  // Send a request along a link. A zero-tick link delivers it right away.
  forward(job: Job, from: string, to: string) {
    const ticks = (this.links.get(from) ?? []).find((l) => l.to === to)?.ticks ?? 0
    if (ticks <= 0) this.deliver(job, to)
    else this.inTransit.push({ job, from, to, progress: 0, ticks })
  }

  deliver(job: Job, to: string) {
    const node = this.nodes.get(to)
    if (!node) return this.drop(job, to)
    node.receive(job, this)
  }

  complete(job: Job) {
    this.stats.completed++
    this.stats.latencies.push(this.tick - job.createdAt)
    if (this.stats.latencies.length > LATENCY_WINDOW) this.stats.latencies.shift()
    this.onComplete?.(job, this.tick - job.createdAt)
  }

  drop(job: Job, node: string) {
    this.stats.dropped++
    this.recentDrops.push({ jobId: job.id, node, tick: this.tick })
  }

  // A crashed node loses what it held and what was on its way to it.
  fail(key: string) {
    const node = this.nodes.get(key)
    const lost = [...(node?.lose?.() ?? []), ...this.inTransit.filter((t) => t.to === key).map((t) => t.job)]
    for (const job of lost) this.drop(job, key)
    this.inTransit = this.inTransit.filter((t) => t.to !== key)
  }

  // Requests a node holds plus those already on their way to it.
  pending(node: FlowNode): number {
    return (node.load?.() ?? 0) + this.inTransit.filter((t) => t.to === node.key).length
  }

  // --- Running -----------------------------------------------------------------

  step() {
    this.tick++
    this.recentDrops = this.recentDrops.filter((d) => this.tick - d.tick <= DROP_MEMORY_TICKS)

    for (const node of this.nodes.values()) node.emit?.(this)

    const moving: Transit[] = []
    const arrived: Transit[] = []
    for (const t of this.inTransit) {
      t.progress += 1 / t.ticks
      ;(t.progress < 1 ? moving : arrived).push(t)
    }
    this.inTransit = moving
    for (const t of arrived) this.deliver(t.job, t.to)

    for (const node of this.nodes.values()) if (node.alive) node.process?.(this)
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
}
