// Message queues, on the shared flow engine:
//
//   users ──▶ app ──▶ queue ──▶ workers
//                \_____________/   (no queue: the app hands the job straight over)
//
// Every job is slow work (about a second). A worker has two slots, so it
// finishes about two jobs a second.
//   - Without a queue the user waits for the job, and a worker with a full
//     line turns new jobs away.
//   - With a queue the app answers at once and the job waits its turn. A
//     worker is only given a job when it has a free slot. A full queue turns
//     jobs away.
//
// With `flaky` on, some jobs fail. A few fail once or twice and then work
// (a service that hiccups); some never work (a bad job). A failed job goes
// back on the queue after a short wait, up to `retries` times. After that it
// is parked in the dead-letter box, or lost when there isn't one.

import { FlowSim, type FlowNode, type Job } from '../../core/flow/engine'
import { Worker } from '../../core/flow/nodes'
import { Fifo } from '../../core/flow/queue'
import type { QueueState } from './types'
import { MAX_WORKERS, TICKS_PER_SECOND, workerIndex, workerKey } from './world'

export const JOB_WORK = 20
export const SLOTS = 2
export const QUEUE_CAPACITY = 100
export const LINK_TICKS = { usersApp: 8, appQueue: 4, queueWorker: 4, appWorker: 6 }
const SYNC_LINE = 3 // jobs a worker lets wait when there is no queue
const ACK_TICKS = 6 // how long the app takes to say “got it”
const BAD_SHARE = 0.2 // jobs that never work
const HICCUP_SHARE = 0.4 // jobs that fail once or twice, then work
const BACKOFF_TICKS = 10 // times the number of tries so far
const WINDOW = TICKS_PER_SECOND * 3
const ACK_SAMPLES = 30

interface Meta {
  failsLeft: number // Infinity: never works
  bad: boolean
  tries: number
}

// Users send one job at a steady rate.
class Users implements FlowNode {
  alive = true
  rate = 0 // jobs per tick
  readonly key = 'users'
  private carry = 0
  private q: QueueSim

  constructor(q: QueueSim) {
    this.q = q
  }

  receive(job: Job, sim: FlowSim) {
    sim.complete(job)
  }

  emit(sim: FlowSim) {
    this.carry += this.rate
    while (this.carry >= 1) {
      this.carry -= 1
      const job = sim.newJob(JOB_WORK, undefined, this.key)
      this.q.meta.set(job, this.q.roll(sim.rng))
      this.q.sent++
      sim.forward(job, this.key, 'app')
    }
  }
}

// The app: answers the user, then queues the job or hands it to a worker.
class App implements FlowNode {
  alive = true
  readonly key = 'app'
  private q: QueueSim

  constructor(q: QueueSim) {
    this.q = q
  }

  receive(job: Job, sim: FlowSim) {
    if (this.q.queued) {
      this.q.acknowledge(ACK_TICKS)
      return sim.forward(job, this.key, 'queue')
    }
    const to = this.q.nextWorker()
    if (to) sim.forward(job, this.key, to)
    else sim.drop(job, this.key)
  }
}

export interface QueueMetrics {
  errorRate: number // percent of jobs turned away
  responseSeconds: number // what the user waits for an answer; NaN with none yet
  backlog: number // jobs waiting
  waitSeconds: number // how long the oldest job has waited
  doneRate: number // jobs finished per second
  load: number // how busy the workers in use were, 0–1
  lost: number // jobs thrown away for good (this window)
  stuck: number // jobs parked that would have worked with more tries (this window)
}

interface Sample {
  sent: number
  dropped: number
  done: number
  lost: number
  stuck: number
  busy: number
}

export class QueueSim {
  readonly flow: FlowSim
  readonly fifo: Fifo
  readonly workers: Worker[] = []
  readonly meta = new WeakMap<Job, Meta>()
  sent = 0
  done = 0
  lost = 0
  parked = 0 // in the dead-letter box now
  stuck = 0 // of those, jobs that only needed another try
  queued = false

  private users: Users
  private count = 0
  private flaky = false
  private retries = 0
  private deadLetter = false
  private turn = 0
  private retrying: { job: Job; at: number }[] = []
  private acks: number[] = []
  private busy = 0
  private history: Sample[] = []

  constructor(rng: () => number = Math.random) {
    this.flow = new FlowSim(rng)
    this.users = this.flow.add(new Users(this))
    this.flow.add(new App(this))
    this.fifo = this.flow.add(new Fifo('queue', QUEUE_CAPACITY))
    this.fifo.canTake = (key) => workerIndex(key) < this.count
    this.flow.link('users', 'app', LINK_TICKS.usersApp)
    this.flow.link('app', 'queue', LINK_TICKS.appQueue)
    for (let i = 0; i < MAX_WORKERS; i++) {
      const w = this.flow.add(new Worker(workerKey(i), { slots: SLOTS, queueLimit: SYNC_LINE, workPerRequest: JOB_WORK }))
      w.onFinish = (job, sim) => this.finished(job, sim)
      this.flow.link('app', w.key, LINK_TICKS.appWorker)
      this.flow.link('queue', w.key, LINK_TICKS.queueWorker)
      this.workers.push(w)
    }
  }

  get tick() {
    return this.flow.tick
  }

  inUse(i: number) {
    return i < this.count
  }

  apply(st: QueueState) {
    this.users.rate = st.rps / TICKS_PER_SECOND
    this.queued = st.queued
    this.count = st.workers
    this.flaky = st.flaky
    this.retries = st.retries
    this.deadLetter = st.deadLetter
    // A queue hands over jobs only when a slot is free; without one, each
    // worker lets a few wait in its own line.
    for (const w of this.workers) w.queueLimit = st.queued ? 1 : SYNC_LINE
  }

  // What will happen to a new job.
  roll(rng: () => number): Meta {
    if (!this.flaky) return { failsLeft: 0, bad: false, tries: 0 }
    const r = rng()
    if (r < BAD_SHARE) return { failsLeft: Infinity, bad: true, tries: 0 }
    if (r < BAD_SHARE + HICCUP_SHARE) return { failsLeft: rng() < 0.4 ? 1 : 2, bad: false, tries: 0 }
    return { failsLeft: 0, bad: false, tries: 0 }
  }

  acknowledge(ticks: number) {
    this.acks.push(ticks)
    if (this.acks.length > ACK_SAMPLES) this.acks.shift()
  }

  nextWorker(): string | undefined {
    if (this.count === 0) return undefined
    return workerKey(this.turn++ % this.count)
  }

  private finished(job: Job, sim: FlowSim) {
    const meta = this.meta.get(job)!
    if (meta.failsLeft <= 0) {
      this.done++
      if (!this.queued) this.acknowledge(sim.tick - job.createdAt)
      return
    }
    meta.failsLeft--
    meta.tries++
    if (this.queued && meta.tries <= this.retries) {
      this.retrying.push({ job, at: sim.tick + BACKOFF_TICKS * meta.tries })
    } else if (this.queued && this.deadLetter) {
      this.parked++
      if (!meta.bad) this.stuck++
    } else {
      this.lost++
    }
  }

  step() {
    this.flow.step()
    const t = this.flow.tick
    const due = this.retrying.filter((r) => r.at <= t)
    this.retrying = this.retrying.filter((r) => r.at > t)
    for (const r of due) this.fifo.receive(r.job, this.flow)

    const inUse = this.workers.slice(0, this.count)
    this.busy += inUse.length === 0 ? 0 : inUse.reduce((sum, w) => sum + w.active.length / w.slots, 0) / inUse.length
    this.history.push({ sent: this.sent, dropped: this.flow.stats.dropped, done: this.done, lost: this.lost, stuck: this.stuck, busy: this.busy })
    if (this.history.length > WINDOW + 1) this.history.shift()
  }

  // Jobs waiting: in the queue, or in front of the workers.
  get backlog() {
    return this.fifo.jobs.length + this.workers.reduce((sum, w) => sum + w.queue.length, 0)
  }

  get metrics(): QueueMetrics {
    const acks = this.acks
    const responseSeconds = acks.length === 0 ? NaN : acks.reduce((a, b) => a + b, 0) / acks.length / TICKS_PER_SECOND
    const waitSeconds = this.fifo.oldestAge(this.flow.tick) / TICKS_PER_SECOND
    const h = this.history
    const span = h.length - 1
    if (span <= 0) return { errorRate: 0, responseSeconds, backlog: this.backlog, waitSeconds, doneRate: 0, load: 0, lost: 0, stuck: 0 }
    const a = h[0]
    const b = h[span]
    const sent = b.sent - a.sent
    return {
      errorRate: sent === 0 ? 0 : ((b.dropped - a.dropped) / sent) * 100,
      responseSeconds,
      backlog: this.backlog,
      waitSeconds,
      doneRate: ((b.done - a.done) * TICKS_PER_SECOND) / span,
      load: (b.busy - a.busy) / span,
      lost: b.lost - a.lost,
      stuck: b.stuck - a.stuck,
    }
  }
}
