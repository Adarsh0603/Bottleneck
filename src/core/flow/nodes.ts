import type { FlowNode, FlowSim, Job } from './engine'

// The building blocks most systems are made of. Each new topic can add more
// (cache, queue, rate limiter, ...) by implementing FlowNode.

// Users sending requests at a steady average rate, each needing a random
// amount of work between minWork and maxWork.
export class Source implements FlowNode {
  alive = true
  rate = 0 // requests per tick
  minWork = 10
  maxWork = 40
  // What each request asks for (e.g. which item), if the system cares.
  keyOf?: (rng: () => number) => number
  private carry = 0
  readonly key: string

  constructor(key: string) {
    this.key = key
  }

  receive(job: Job, sim: FlowSim) {
    // Nothing is sent to users in these systems; treat it as an answer.
    sim.complete(job)
  }

  emit(sim: FlowSim) {
    this.carry += this.rate
    while (this.carry >= 1) {
      this.carry -= 1
      const work = this.minWork + Math.floor(sim.rng() * (this.maxWork - this.minWork + 1))
      const job = sim.newJob(work, this.keyOf?.(sim.rng))
      const to = sim.targets(this.key)[0]
      if (to) sim.forward(job, this.key, to.key)
      else sim.drop(job, this.key)
    }
  }
}

// 'direct' means there is no real balancer: requests always go to the first
// target, so the others sit idle.
export type Algorithm = 'direct' | 'round-robin' | 'random' | 'least-connections' | 'power-of-two'

// A load balancer: hands each request to one of its targets, instantly.
export class Router implements FlowNode {
  alive = true
  algorithm: Algorithm = 'round-robin'
  private rrIndex = 0
  readonly key: string

  constructor(key: string) {
    this.key = key
  }

  receive(job: Job, sim: FlowSim) {
    const target = this.pick(sim)
    if (target) sim.forward(job, this.key, target.key)
    else sim.drop(job, this.key)
  }

  pick(sim: FlowSim): FlowNode | undefined {
    const targets = sim.targets(this.key)
    if (this.algorithm === 'direct') {
      const first = targets[0]
      return first?.alive ? first : undefined
    }

    const alive = targets.filter((t) => t.alive)
    if (alive.length === 0) return undefined

    switch (this.algorithm) {
      case 'round-robin': {
        const target = alive[this.rrIndex % alive.length]
        this.rrIndex = (this.rrIndex + 1) % alive.length
        return target
      }
      case 'random':
        return alive[Math.floor(sim.rng() * alive.length)]
      case 'least-connections':
        // Counts requests already on their way too, otherwise a burst all
        // lands on the same "empty" server before any of it arrives.
        return alive.reduce((best, t) => (sim.pending(t) < sim.pending(best) ? t : best))
      case 'power-of-two': {
        // Sample two different targets and keep the less busy one.
        if (alive.length === 1) return alive[0]
        const i = Math.floor(sim.rng() * alive.length)
        let j = Math.floor(sim.rng() * (alive.length - 1))
        if (j >= i) j++
        return sim.pending(alive[j]) < sim.pending(alive[i]) ? alive[j] : alive[i]
      }
    }
  }
}

// A server: a few worker slots and a waiting line. A request waits in the
// queue, then takes a slot until its work is done (faster servers burn
// through work quicker). Finished requests go on to the next node if there is
// one, otherwise they're answered. A full queue turns new requests away.
//
// Each request needs its own `work` at this node, unless the node has a fixed
// cost per request (`workPerRequest`), e.g. a database lookup.
export class Worker implements FlowNode {
  alive = true
  active: Job[] = []
  queue: Job[] = []
  served = 0
  speed: number
  slots: number
  queueLimit: number
  workPerRequest?: number
  // Work for a particular request, when some cost more than others (e.g. an
  // expensive query). Takes priority over workPerRequest.
  workOf?: (job: Job) => number
  // Called as each request finishes here, e.g. a database filling a cache.
  onFinish?: (job: Job, sim: FlowSim) => void
  readonly key: string

  constructor(key: string, { speed = 1, slots = 4, queueLimit = 8, workPerRequest = undefined as number | undefined } = {}) {
    this.key = key
    this.speed = speed
    this.slots = slots
    this.queueLimit = queueLimit
    this.workPerRequest = workPerRequest
  }

  receive(job: Job, sim: FlowSim) {
    if (!this.alive || this.queue.length >= this.queueLimit) return sim.drop(job, this.key)
    job.remaining = this.workOf?.(job) ?? this.workPerRequest ?? job.work
    this.queue.push(job)
  }

  process(sim: FlowSim) {
    while (this.active.length < this.slots && this.queue.length > 0) {
      this.active.push(this.queue.shift()!)
    }
    const stillWorking: Job[] = []
    for (const job of this.active) {
      job.remaining -= this.speed
      if (job.remaining > 0) {
        stillWorking.push(job)
        continue
      }
      this.served++
      this.onFinish?.(job, sim)
      const next = sim.targets(this.key)[0]
      if (next) sim.forward(job, this.key, next.key)
      else sim.complete(job)
    }
    this.active = stillWorking
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
