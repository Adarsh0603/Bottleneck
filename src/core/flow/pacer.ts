import type { FlowNode, FlowSim, Job } from './engine'

// Lets jobs through at a steady pace and holds the rest back in a buffer,
// instead of turning them away. Use it in front of anything with a rate limit
// you cannot change. Jobs it does not apply to pass straight through. Each
// job goes to the next of its targets in turn.
export class Pacer implements FlowNode {
  alive = true
  rate = 1 // jobs released per tick
  capacity = 200 // how many it will hold before turning jobs away
  // Which jobs are held back; the rest are passed on at once.
  applies: (job: Job) => boolean = () => true
  readonly key: string
  readonly held: Job[] = []
  private carry = 0
  private turn = 0

  constructor(key: string) {
    this.key = key
  }

  receive(job: Job, sim: FlowSim) {
    if (!this.applies(job)) return this.pass(job, sim)
    if (this.held.length >= this.capacity) return sim.drop(job, this.key)
    this.held.push(job)
  }

  process(sim: FlowSim) {
    this.carry = Math.min(this.carry + this.rate, Math.max(1, this.rate))
    while (this.carry >= 1 && this.held.length > 0) {
      this.carry -= 1
      this.pass(this.held.shift()!, sim)
    }
  }

  private pass(job: Job, sim: FlowSim) {
    const next = sim.targets(this.key).filter((t) => t.alive)
    if (next.length === 0) return sim.drop(job, this.key)
    sim.forward(job, this.key, next[this.turn++ % next.length].key)
  }

  load() {
    return this.held.length
  }

  lose() {
    return this.held.splice(0)
  }
}
