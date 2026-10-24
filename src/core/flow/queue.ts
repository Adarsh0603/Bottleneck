import type { FlowNode, FlowSim, Job } from './engine'
import { Worker } from './nodes'

// A message queue: jobs wait here, in order, until a worker has a free slot.
// A full queue turns new jobs away. Workers never get more than they can
// start, so the waiting happens here, not in front of each worker.
export class Fifo implements FlowNode {
  alive = true
  jobs: Job[] = []
  capacity: number
  // Limits which workers may be given jobs, e.g. only those switched on.
  canTake?: (key: string) => boolean
  // Jobs handed to a worker beyond its free slots, so a slot never sits idle
  // while the next job is on its way.
  prefetch = 1
  readonly key: string
  private since = new Map<Job, number>()

  constructor(key: string, capacity: number) {
    this.key = key
    this.capacity = capacity
  }

  receive(job: Job, sim: FlowSim) {
    if (this.jobs.length >= this.capacity) return sim.drop(job, this.key)
    this.jobs.push(job)
    this.since.set(job, sim.tick)
  }

  process(sim: FlowSim) {
    const workers = sim.targets(this.key).filter((t): t is Worker => t instanceof Worker && t.alive && (this.canTake?.(t.key) ?? true))
    while (this.jobs.length > 0) {
      let best: Worker | undefined
      for (const w of workers) {
        const pending = sim.pending(w)
        if (pending < w.slots + this.prefetch && (!best || pending < sim.pending(best))) best = w
      }
      if (!best) break
      const job = this.jobs.shift()!
      this.since.delete(job)
      sim.forward(job, this.key, best.key)
    }
  }

  // How long the oldest waiting job has waited, in ticks.
  oldestAge(tick: number): number {
    const first = this.jobs[0]
    return first ? tick - (this.since.get(first) ?? tick) : 0
  }

  load() {
    return this.jobs.length
  }

  lose() {
    const lost = this.jobs
    this.jobs = []
    this.since.clear()
    return lost
  }
}
