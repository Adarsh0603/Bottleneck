import type { FlowNode, FlowSim, Job } from './engine'
import { Worker } from './nodes'

// A queue with lanes. Workers always take from the most urgent lane that has
// anything waiting, so a flood in a low lane never holds up a high one. Each
// lane has its own room: a full lane turns away only its own jobs.
export class PriorityQueue implements FlowNode {
  alive = true
  readonly lanes: Job[][]
  laneCapacity: number
  // Which lane a job joins; 0 is the most urgent.
  laneOf: (job: Job) => number = () => 0
  // Jobs handed to a worker beyond its free slots, like Fifo's.
  prefetch = 1
  readonly key: string

  constructor(key: string, lanes: number, laneCapacity: number) {
    this.key = key
    this.lanes = Array.from({ length: lanes }, () => [])
    this.laneCapacity = laneCapacity
  }

  // Every waiting job, most urgent first. The drawing reads this.
  get jobs() {
    return this.lanes.flat()
  }

  get capacity() {
    return this.laneCapacity * this.lanes.length
  }

  receive(job: Job, sim: FlowSim) {
    const lane = Math.min(Math.max(this.laneOf(job), 0), this.lanes.length - 1)
    if (this.lanes[lane].length >= this.laneCapacity) return sim.drop(job, this.key)
    this.lanes[lane].push(job)
  }

  process(sim: FlowSim) {
    const workers = sim.targets(this.key).filter((t): t is Worker => t instanceof Worker && t.alive)
    for (;;) {
      const lane = this.lanes.find((l) => l.length > 0)
      if (!lane) break
      let best: Worker | undefined
      for (const w of workers) {
        const pending = sim.pending(w)
        if (pending < w.slots + this.prefetch && (!best || pending < sim.pending(best))) best = w
      }
      if (!best) break
      sim.forward(lane.shift()!, this.key, best.key)
    }
  }

  load() {
    return this.lanes.reduce((n, l) => n + l.length, 0)
  }

  lose() {
    const lost = this.jobs
    for (const l of this.lanes) l.length = 0
    return lost
  }
}
