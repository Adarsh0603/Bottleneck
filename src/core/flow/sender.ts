import type { FlowSim, Job } from './engine'
import { Worker } from './nodes'
import { replierOf, type Replier } from './provider'

// Holds messages that gave up: the retries ran out. They are kept, not lost,
// so someone can look at them and send them again later.
export class DeadLetters {
  alive = true
  jobs: Job[] = []
  capacity: number
  readonly key: string

  constructor(key: string, capacity = 100) {
    this.key = key
    this.capacity = capacity
  }

  receive(job: Job) {
    this.jobs.push(job)
  }

  load() {
    return this.jobs.length
  }
}

// Remembers which messages have gone out, so a retry of one that already did
// is answered here and never sent again. It stands in for the idempotency key
// a provider checks. Put it between the senders and the provider, and have
// the provider's `onSent` call `mark`.
export class DedupeStore {
  alive = true
  seen = new Set<number>()
  blocked = 0
  readonly key: string

  constructor(key: string) {
    this.key = key
  }

  mark(job: Job) {
    this.seen.add(job.msg ?? job.id)
  }

  receive(job: Job, sim: FlowSim) {
    if (this.seen.has(job.msg ?? job.id)) {
      this.blocked++
      return replierOf(sim, job)?.reply(job, true, sim)
    }
    const targets = sim.targets(this.key)
    const next = targets.find((t) => t.key === job.via) ?? targets[0]
    if (next) sim.forward(job, this.key, next.key)
    else sim.drop(job, this.key)
  }

  load() {
    return this.seen.size
  }
}

interface Call {
  job: Job
  due: number // tick the call counts as timed out
}

interface Retry {
  job: Job
  at: number
}

// A worker that sends each message through a provider and waits for the
// answer, holding its slot while it waits. If the call fails or times out it
// tries again after a pause that doubles each time, up to `maxAttempts`
// sends. After that the message goes to a dead-letter queue if one is linked,
// or is lost.
export class Sender extends Worker implements Replier {
  maxAttempts = 3 // 1 means never retry
  backoff = 10 // ticks to wait before the first retry
  timeout = 30 // ticks to wait for an answer
  retries = 0
  private calls = new Map<number, Call>()
  private waiting: Retry[] = []

  receive(job: Job, sim: FlowSim) {
    job.attempts = job.attempts ?? 0
    super.receive(job, sim)
  }

  process(sim: FlowSim) {
    for (const r of this.waiting.filter((w) => w.at <= sim.tick)) this.queue.push(r.job)
    this.waiting = this.waiting.filter((w) => w.at > sim.tick)

    while (this.active.length < this.slots && this.queue.length > 0) {
      const job = this.queue.shift()!
      job.remaining = this.workOf?.(job) ?? this.workPerRequest ?? job.work
      this.active.push(job)
    }
    for (const job of [...this.active]) {
      const call = this.calls.get(job.id)
      if (call) {
        if (call.due <= sim.tick) this.fail(job, sim)
        continue
      }
      job.remaining -= this.speed
      if (job.remaining > 0) continue
      this.send(job, sim)
    }
  }

  private send(job: Job, sim: FlowSim) {
    // Through a dedupe store if there is one, else straight to the provider the message is for.
    const targets = sim.targets(this.key)
    const provider = targets.find((t) => t instanceof DedupeStore) ?? targets.find((t) => t.key === job.via) ?? targets.find((t) => !(t instanceof DeadLetters))
    if (!provider) return this.finish(job, () => sim.drop(job, this.key))
    job.attempts = (job.attempts ?? 0) + 1
    job.caller = this.key
    this.calls.set(job.id, { job, due: sim.tick + this.timeout })
    sim.forward(job, this.key, provider.key)
  }

  // The provider answered. An answer that comes after the call timed out is ignored.
  reply(job: Job, ok: boolean, sim: FlowSim) {
    if (!this.calls.has(job.id)) return
    if (ok) {
      this.served++
      this.finish(job, () => sim.complete(job))
    } else this.fail(job, sim)
  }

  private fail(job: Job, sim: FlowSim) {
    if ((job.attempts ?? 0) < this.maxAttempts) {
      this.retries++
      this.finish(job, () => this.waiting.push({ job, at: sim.tick + this.backoff * 2 ** ((job.attempts ?? 1) - 1) }))
      return
    }
    const dead = sim.targets(this.key).find((t) => t instanceof DeadLetters)
    this.finish(job, () => (dead ? sim.forward(job, this.key, dead.key) : sim.drop(job, this.key)))
  }

  // Free the slot, then do what comes next.
  private finish(job: Job, then: () => void) {
    this.calls.delete(job.id)
    this.active = this.active.filter((j) => j !== job)
    then()
  }

  load() {
    return super.load() + this.waiting.length
  }

  lose() {
    const lost = [...super.lose(), ...this.waiting.map((w) => w.job)]
    this.calls.clear()
    this.waiting = []
    return lost
  }
}
