import type { FlowNode, FlowSim, Job } from './engine'

// An outside service we pay to deliver messages (an SMS gateway, an email
// service, a push network). We do not run it, so we cannot make it faster or
// more reliable. It answers each call after `latency` ticks, and it:
//   - turns calls away past its rate limit, and fails every call in an outage
//   - sometimes fails a call outright (the message is not sent)
//   - sometimes sends the message but loses the answer, so the caller sees
//     nothing and cannot tell whether it went out. A retry then sends it twice.

// A node that waits for the answer to a call.
export interface Replier {
  reply(job: Job, ok: boolean, sim: FlowSim): void
}

export const replierOf = (sim: FlowSim, job: Job) => {
  const node = job.caller ? (sim.node(job.caller) as Partial<Replier> | undefined) : undefined
  return node?.reply ? (node as Replier) : undefined
}

type Outcome = 'ok' | 'fail' | 'lost'

interface Call {
  job: Job
  due: number
  outcome: Outcome
}

export class Provider implements FlowNode {
  alive = true
  down = false // an outage: every call fails at once
  latency = 10 // ticks to answer
  failRate = 0 // share of calls that fail without sending
  lostRate = 0 // share of calls that send but whose answer is lost
  limit = Infinity // calls it takes per window; the rest are turned away
  window = 20 // ticks in one rate-limit window
  // How many times each message was actually sent, by message id.
  sent = new Map<number, number>()
  turnedAway = 0
  failed = 0
  // Called as a message goes out, e.g. to record it in a dedupe store.
  onSent?: (job: Job) => void
  readonly key: string
  private calls: Call[] = []
  private windowAt = -1
  private taken = 0

  constructor(key: string) {
    this.key = key
  }

  receive(job: Job, sim: FlowSim) {
    const w = Math.floor(sim.tick / this.window)
    if (w !== this.windowAt) {
      this.windowAt = w
      this.taken = 0
    }
    if (this.down || this.taken >= this.limit) {
      if (!this.down) this.turnedAway++
      this.failed++
      return replierOf(sim, job)?.reply(job, false, sim)
    }
    this.taken++
    const r = sim.rng()
    const outcome: Outcome = r < this.failRate ? 'fail' : r < this.failRate + this.lostRate ? 'lost' : 'ok'
    this.calls.push({ job, due: sim.tick + this.latency, outcome })
  }

  process(sim: FlowSim) {
    const later: Call[] = []
    for (const c of this.calls) {
      if (c.due > sim.tick) {
        later.push(c)
        continue
      }
      if (c.outcome !== 'fail') {
        const msg = c.job.msg ?? c.job.id
        this.sent.set(msg, (this.sent.get(msg) ?? 0) + 1)
        this.onSent?.(c.job)
      } else this.failed++
      if (c.outcome !== 'lost') replierOf(sim, c.job)?.reply(c.job, c.outcome === 'ok', sim)
    }
    this.calls = later
  }

  // Messages that went out more than once.
  duplicates() {
    let n = 0
    for (const count of this.sent.values()) n += count - 1
    return n
  }

  load() {
    return this.calls.length
  }

  lose() {
    const lost = this.calls.map((c) => c.job)
    this.calls = []
    return lost
  }
}
