import { TICKS_PER_SECOND } from '../../core/build/run'
import type { BuildTask } from '../../core/build/types'
import { FlowSim, type FlowNode, type Job } from '../../core/flow/engine'
import { Source, Worker } from '../../core/flow/nodes'
import { Fifo } from '../../core/flow/queue'

// Build it: a flash sale. Orders arrive at 4 a second, then jump to 14 a
// second for 8 seconds, then drop back. Each order is a slow job (about a
// second); a worker gets through two a second. The learner places the pieces:
//   - With no queue the app hands every job straight to a worker, and a
//     worker lets only a few wait. The spike is more than they can take, so
//     jobs are turned away.
//   - A queue holds the spike and the workers drain it, but it only holds so
//     much. Too few workers and it overflows, and jobs are turned away.
// Winning takes the queue and enough workers that nothing is lost, and the
// backlog is gone once the sale is over.

const BASE_RPS = 4
const BURST_RPS = 14
const BURST_START = 6 * TICKS_PER_SECOND
const BURST_END = 14 * TICKS_PER_SECOND
const SETTLED = 30 * TICKS_PER_SECOND
const JOB_WORK = 20
const QUEUE_CAPACITY = 40
const SYNC_LINE = 3
const MAX_WAIT = 8 * TICKS_PER_SECOND

const workerPads = Array.from({ length: 6 }, (_, i) => `worker-${i}`)
const COLUMN_X = 4.4
const COLUMN_Z = [-5.5, -3.3, -1.1, 1.1, 3.3, 5.5]

// What the learner needs to see about the sale.
interface Sale {
  longestWait: number // ticks
}
export const saleOf = new WeakMap<FlowSim, Sale>()

class Orders extends Source {
  constructor() {
    super('users')
    this.minWork = this.maxWork = JOB_WORK
  }
}

// The app: queues the job if there's a queue, else hands it to a worker.
class App implements FlowNode {
  alive = true
  readonly key = 'app'
  private workers: string[]
  private turn = 0

  constructor(workers: string[]) {
    this.workers = workers
  }

  receive(job: Job, sim: FlowSim) {
    if (sim.node('queue')) return sim.forward(job, this.key, 'queue')
    if (this.workers.length === 0) return sim.drop(job, this.key)
    sim.forward(job, this.key, this.workers[this.turn++ % this.workers.length])
  }
}

// Does something every tick, e.g. sets the traffic for this moment.
class Clock implements FlowNode {
  alive = true
  readonly key: string
  private tick: (sim: FlowSim) => void

  constructor(key: string, tick: (sim: FlowSim) => void) {
    this.key = key
    this.tick = tick
  }

  receive() {}

  process(sim: FlowSim) {
    this.tick(sim)
  }
}

export const backlogOf = (flow: FlowSim) => {
  const queue = flow.node('queue')
  const waiting = queue instanceof Fifo ? queue.jobs.length : 0
  return waiting + flow.all().reduce((sum, n) => sum + (n instanceof Worker ? n.queue.length : 0), 0)
}

export const FLASH_SALE: BuildTask = {
  title: 'Build it: survive the flash sale.',
  sub: 'Place a queue and workers, then watch the orders roll in. Changing anything restarts the run.',
  brief: [
    'A flash sale starts. Orders usually arrive at 4 a second. Ten seconds from now they jump to 14 a second for 8 seconds, then drop back.',
    'Each order is a slow job, such as charging a card and sending an email. A worker gets through 2 a second.',
    'Without a queue, the app hands each job straight to a worker, and a worker only lets a few wait. A queue holds the jobs instead, and the workers take them as they free up. But a queue holds only so many.',
    'Your job: lose no order, and be caught up once the sale is over.',
  ],
  manualStart: true,
  goal: 'No order lost, and the backlog cleared after the sale.',
  goalShort: 'No order lost · backlog cleared',
  win: 'The queue soaked up the spike and the workers drained it. Nothing was turned away, and nobody waited too long.',
  holdSeconds: 4,
  rps: BURST_RPS,
  shot: { target: [-1.4, 0.7, 0], zoom: 0.62 },
  fixed: [
    { id: 'users', kind: 'users', x: -7.8, z: 0 },
    { id: 'app', kind: 'app', x: -4.6, z: 0 },
  ],
  pads: [
    { id: 'queue', x: -0.2, z: 0, accepts: ['queue'] },
    ...workerPads.map((id, i) => ({ id, x: COLUMN_X, z: COLUMN_Z[i], accepts: ['server' as const] })),
  ],
  toolbox: [
    { kind: 'queue', count: 1 },
    { kind: 'server', count: 6 },
  ],
  watch: [
    { kind: 'note', label: 'Orders lost', read: (flow) => ({ text: String(flow.stats.dropped), bad: flow.stats.dropped > 0 }) },
    { kind: 'note', label: 'Waiting', read: (flow) => ({ text: String(backlogOf(flow)), bad: backlogOf(flow) >= QUEUE_CAPACITY * 0.8 }) },
    {
      kind: 'note',
      label: 'Longest wait',
      read: (flow) => {
        const ticks = saleOf.get(flow)?.longestWait ?? 0
        return { text: `${(ticks / TICKS_PER_SECOND).toFixed(1)}s`, bad: ticks > MAX_WAIT }
      },
    },
  ],

  assemble(placed, _settings, rng) {
    const flow = new FlowSim(rng)
    const sale: Sale = { longestWait: 0 }
    saleOf.set(flow, sale)

    const workers = workerPads.filter((id) => placed[id])
    const orders = flow.add(new Orders())
    flow.add(new App(workers))
    flow.link('users', 'app', 8)

    const fifo = placed.queue ? flow.add(new Fifo('queue', QUEUE_CAPACITY)) : undefined
    if (fifo) flow.link('app', 'queue', 4)
    for (const id of workers) {
      flow.add(new Worker(id, { slots: 2, queueLimit: fifo ? 1 : SYNC_LINE, workPerRequest: JOB_WORK }))
      flow.link('app', id, 6)
      if (fifo) flow.link('queue', id, 4)
    }

    flow.add(
      new Clock('clock', (sim) => {
        orders.rate = (sim.tick >= BURST_START && sim.tick < BURST_END ? BURST_RPS : BASE_RPS) / TICKS_PER_SECOND
        if (fifo) sale.longestWait = Math.max(sale.longestWait, fifo.oldestAge(sim.tick))
      }),
    )
    return flow
  },

  problem(_m, placed, _settings, flow) {
    const workers = workerPads.filter((id) => placed[id]).length
    const lost = flow.stats.dropped
    if (workers === 0) return 'There are no workers, so nothing does the work. Place servers on the pads on the right.'
    if (!placed.queue && lost > 0) {
      return 'With no queue, every job lands straight on a worker. The spike is more than they can take at once, so orders are turned away. Place the queue between the app and the workers.'
    }
    if (placed.queue && lost > 0) {
      return 'The queue filled up and turned orders away. The workers drain it too slowly while the spike lasts. Add more workers.'
    }
    if (placed.queue && flow.tick > BURST_END + 8 * TICKS_PER_SECOND && backlogOf(flow) > 10) {
      return 'Orders are still piling up after the sale. The workers are barely keeping up with the normal rate. Add more workers so they can catch up.'
    }
    return null
  },

  check: (_m, placed, _settings, flow) => {
    if (!flow || !placed.queue) return false
    const longest = saleOf.get(flow)?.longestWait ?? 0
    return flow.tick > SETTLED && flow.stats.dropped === 0 && backlogOf(flow) < 3 && longest <= MAX_WAIT
  },
}
