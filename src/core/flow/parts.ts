import { FlowSim, type FlowNode, type Job } from './engine'
import { SECOND } from './time'

// Building blocks the capstone simulations share. Each one is generic: the
// simulation says what happens when a request gets through or is turned away.

// A simulation that tells its owner when something was thrown away on its way.
export class Net extends FlowSim {
  onLoss?: (job: Job, node: string) => void
  drop(job: Job, node: string) {
    super.drop(job, node)
    this.onLoss?.(job, node)
  }
}

// Workers that take a few at a time: a server or a shard of a store.
export class Pool implements FlowNode {
  alive = true
  active: Job[] = []
  queue: Job[] = []
  refuse?: () => boolean // turns requests away while it returns true
  readonly key: string
  private slots: number
  private line: number
  private done: (job: Job, sim: FlowSim) => void
  constructor(key: string, slots: number, line: number, done: (job: Job, sim: FlowSim) => void) {
    this.key = key
    this.slots = slots
    this.line = line
    this.done = done
  }
  receive(job: Job, sim: FlowSim) {
    if (!this.alive || this.queue.length >= this.line || this.refuse?.()) return sim.drop(job, this.key)
    job.remaining = job.work
    this.queue.push(job)
  }
  process(sim: FlowSim) {
    while (this.active.length < this.slots && this.queue.length) this.active.push(this.queue.shift()!)
    const left: Job[] = []
    for (const job of this.active) {
      if (--job.remaining > 0) left.push(job)
      else this.done(job, sim)
    }
    this.active = left
  }
  load() {
    return this.active.length + this.queue.length
  }
  lose() {
    const lost = [...this.active, ...this.queue]
    this.active = []
    this.queue = []
    return lost
  }
}

// A part standing where requests cannot get through: it turns everything away.
export class Jam implements FlowNode {
  alive = true
  readonly key: string
  constructor(key: string) {
    this.key = key
  }
  receive(job: Job, sim: FlowSim) {
    sim.drop(job, this.key)
  }
}

// Lets only so many requests a second through.
export class TokenBucket {
  private rate: number
  private tokens: number
  private last = 0
  constructor(rate: number) {
    this.rate = rate
    this.tokens = rate
  }
  take(tick: number) {
    this.tokens = Math.min(this.rate, this.tokens + ((tick - this.last) * this.rate) / SECOND)
    this.last = tick
    if (this.tokens < 1) return false
    this.tokens--
    return true
  }
}

// A rate limiter: requests over the rate are turned away, the rest go on.
export class Limiter implements FlowNode {
  alive = true
  readonly key: string
  private bucket: TokenBucket
  private limited: () => void
  private pass: (job: Job, sim: FlowSim) => void
  constructor(key: string, rate: number, limited: () => void, pass: (job: Job, sim: FlowSim) => void) {
    this.key = key
    this.bucket = new TokenBucket(rate)
    this.limited = limited
    this.pass = pass
  }
  receive(job: Job, sim: FlowSim) {
    if (!this.bucket.take(sim.tick)) {
      this.limited()
      return sim.drop(job, this.key)
    }
    this.pass(job, sim)
  }
}

// Holds work until a worker is free.
export class Queue implements FlowNode {
  alive = true
  jobs: Job[] = []
  readonly key: string
  private capacity: number
  private workers: () => FlowNode[]
  constructor(key: string, capacity: number, workers: () => FlowNode[]) {
    this.key = key
    this.capacity = capacity
    this.workers = workers
  }
  receive(job: Job, sim: FlowSim) {
    if (this.jobs.length >= this.capacity) return sim.drop(job, this.key)
    this.jobs.push(job)
  }
  // A task a crashed worker was holding goes back to the front.
  requeue(job: Job) {
    this.jobs.unshift(job)
  }
  process(sim: FlowSim) {
    for (const w of this.workers()) {
      if (this.jobs.length === 0) break
      if (w.alive && sim.pending(w) === 0) sim.forward(this.jobs.shift()!, this.key, w.key)
    }
  }
  load() {
    return this.jobs.length
  }
}
