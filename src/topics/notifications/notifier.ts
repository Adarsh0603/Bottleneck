import type { FlowNode, FlowSim } from '../../core/flow/engine'
import { Ledger } from '../../core/flow/ledger'
import { Pacer } from '../../core/flow/pacer'
import { PriorityQueue } from '../../core/flow/priority'
import { Provider } from '../../core/flow/provider'
import { Fifo } from '../../core/flow/queue'
import { Router, Source } from '../../core/flow/nodes'
import { DeadLetters, DedupeStore, Sender } from '../../core/flow/sender'

// The notification service, as a running system. Three kinds of message:
//   otp    → login codes, by SMS. Someone is waiting on their phone.
//   orders → "your order shipped", by push. Should arrive soon.
//   promo  → marketing, by email. Huge batches, and nobody is waiting.
// Each goes out through an outside provider we cannot change: it has its own
// speed and rate limit, and it fails in its own ways.

export const SECOND = 20
export const KINDS = ['otp', 'orders', 'promo'] as const
export type Kind = (typeof KINDS)[number]
export const CHANNEL: Record<Kind, string> = { otp: 'sms', orders: 'push', promo: 'email' }
export const PROVIDERS = ['sms', 'push', 'email']

// How long each kind may take before it counts as late, in ticks.
export const DEADLINE: Record<Kind, number> = { otp: 4 * SECOND, orders: 30 * SECOND, promo: 60 * SECOND }
export const ATTEMPTS = [1, 2, 3, 5]
export const PACES = [3, 8, 10, 20] // promo messages released per second

const LANE: Record<string, number> = { otp: 0, orders: 1, promo: 2 }
const FIFO_ROOM = 120
const LANE_ROOM = 120
const SENDER_SLOTS = 6
const PREP_WORK = 2

export type Load = Record<Kind, number> // messages per second

// What the outside world is doing at this moment.
export interface World {
  load: Load
  pushDown: boolean
  smsLostRate: number // share of texts sent whose answer never comes back
  failRate: number // share of calls any provider fails
}

export type Profile = (tick: number) => World

export interface Config {
  senders: string[] // keys of the sender servers that stand on the floor
  queue: 'none' | 'line' | 'lanes'
  pace?: number // promo per second; undefined means unpaced
  dead: boolean
  dedupe: boolean
  attempts: number
  profile: Profile
  // Where each part stands, by node key. A part can stand on any spot, so the keys are the learner's.
  // Parts standing out of order. Traffic runs straight into them and goes no further.
  jam?: string[]
  keys?: Partial<Record<'queue' | 'gate' | 'dedupe' | 'dead', string>>
}

// Tags each message with the provider it is for, then spreads them over what it feeds.
class Api extends Router {
  receive(job: Parameters<Router['receive']>[0], sim: FlowSim) {
    job.via = CHANNEL[job.from as Kind]
    super.receive(job, sim)
  }
}

// A part standing in the wrong place in the chain: what reaches it has nowhere to go.
class Jam implements FlowNode {
  alive = true
  readonly key: string
  constructor(key: string) {
    this.key = key
  }
  receive(job: Parameters<FlowNode['receive']>[0], sim: FlowSim) {
    sim.drop(job, this.key)
  }
}

// Sets the world for this moment.
class Clock implements FlowNode {
  alive = true
  readonly key = 'clock'
  private apply: (tick: number) => void
  constructor(apply: (tick: number) => void) {
    this.apply = apply
  }
  receive() {}
  process(sim: FlowSim) {
    this.apply(sim.tick)
  }
}

export class Notifier {
  readonly flow: Ledger
  readonly cfg: Config
  readonly providers: Record<string, Provider> = {}
  readonly store?: DedupeStore
  readonly dead?: DeadLetters
  readonly senders: Sender[] = []
  readonly queue?: Fifo | PriorityQueue
  readonly keys: Record<'queue' | 'gate' | 'dedupe' | 'dead', string>
  // The tick at which each kind first had a message late or lost.
  readonly firstMiss: Partial<Record<Kind, number>> = {}

  constructor(rng: () => number, cfg: Config) {
    this.cfg = cfg
    const keys = (this.keys = { queue: 'q', gate: 'gate', dedupe: 'dedupe', dead: 'dead', ...cfg.keys })
    const flow = (this.flow = new Ledger(rng))
    for (const k of KINDS) flow.deadline[k] = DEADLINE[k]

    const sources = KINDS.map((k) => {
      const s = flow.add(new Source(k))
      s.minWork = s.maxWork = 1
      return s
    })

    // Providers: speed and limits are theirs, not ours.
    const spec: Record<string, { latency: number; limit: number }> = {
      sms: { latency: 20, limit: 20 },
      push: { latency: 4, limit: 40 },
      email: { latency: 24, limit: 12 },
    }
    for (const key of PROVIDERS) {
      const p = flow.add(new Provider(key))
      p.latency = spec[key].latency
      p.limit = spec[key].limit
      this.providers[key] = p
    }

    const addClock = (sources: Source[]) => {
      flow.add(
        new Clock((tick) => {
          const w = cfg.profile(tick)
          sources.forEach((s, i) => (s.rate = w.load[KINDS[i]] / SECOND))
          this.providers.push.down = w.pushDown
          this.providers.sms.lostRate = w.smsLostRate
          for (const p of Object.values(this.providers)) p.failRate = w.failRate
          // When each kind first went wrong, so a red check can say which part of the day did it.
          for (const k of KINDS) if (this.firstMiss[k] === undefined && (flow.lost[k] ?? 0) + (flow.late[k] ?? 0) > 0) this.firstMiss[k] = tick
        }),
      )
    }

    if (cfg.jam?.length) {
      for (const id of cfg.jam) flow.add(new Jam(id))
      flow.add(new Api('api')).algorithm = 'round-robin'
      for (const id of cfg.jam) flow.link('api', id, 3)
      for (const s of sources) flow.link(s.key, 'api', 5)
      addClock(sources)
      return
    }

    if (cfg.dedupe) {
      this.store = flow.add(new DedupeStore(keys.dedupe))
      for (const p of Object.values(this.providers)) p.onSent = (job) => this.store!.mark(job)
      for (const key of PROVIDERS) flow.link(keys.dedupe, key, 3)
    }
    if (cfg.dead) this.dead = flow.add(new DeadLetters(keys.dead, 60))

    for (const key of cfg.senders) {
      const s = flow.add(new Sender(key, { slots: SENDER_SLOTS, queueLimit: 20, workPerRequest: PREP_WORK }))
      s.maxAttempts = cfg.attempts
      this.senders.push(s)
      if (cfg.dedupe) flow.link(key, keys.dedupe, 3)
      else for (const p of PROVIDERS) flow.link(key, p, 4)
      if (cfg.dead) flow.link(key, keys.dead, 3)
    }

    // What the senders are fed from: a queue, or the front door directly.
    let feed: string[] = cfg.senders
    if (cfg.queue === 'lanes') {
      const q = (this.queue = flow.add(new PriorityQueue(keys.queue, KINDS.length, LANE_ROOM)))
      q.laneOf = (job) => LANE[job.from ?? ''] ?? KINDS.length
      q.prefetch = 0
    } else if (cfg.queue === 'line') {
      const q = (this.queue = flow.add(new Fifo(keys.queue, FIFO_ROOM)))
      q.prefetch = 0
    }
    if (this.queue) {
      for (const key of cfg.senders) flow.link(keys.queue, key, 2)
      feed = [keys.queue]
    }

    // A pacer in front of that holds promo back to the pace chosen.
    if (cfg.pace !== undefined) {
      const g = flow.add(new Pacer(keys.gate))
      g.rate = cfg.pace / SECOND
      g.capacity = 400
      g.applies = (job) => job.from === 'promo'
      for (const key of feed) flow.link(keys.gate, key, 3)
      feed = [keys.gate]
    }

    flow.add(new Api('api')).algorithm = 'round-robin'
    for (const key of feed) flow.link('api', key, 3)
    for (const s of sources) flow.link(s.key, 'api', 5)

    addClock(sources)
  }

  get duplicates() {
    return Object.values(this.providers).reduce((n, p) => n + p.duplicates(), 0)
  }

  // Messages of a kind waiting in the dead-letter queue.
  parked(kind: Kind) {
    return this.dead?.jobs.filter((j) => j.from === kind).length ?? 0
  }

  // Messages made but not yet delivered, lost or parked.
  get inFlight() {
    const f = this.flow
    return KINDS.reduce((n, k) => n + Math.max(0, (f.made[k] ?? 0) - (f.done[k] ?? 0) - (f.lost[k] ?? 0) - this.parked(k)), 0)
  }

  // Messages of a kind turned away or given up on, never delivered.
  lostOf(kind: Kind) {
    return this.flow.lost[kind] ?? 0
  }
}
