// Sharding, on the shared flow engine:
//
//                              ┌──▶ shard 1
//   users ──▶ app servers ─────┼──▶ shard 2
//                              └──▶ shard 3
//
// Users write posts and read profiles. Each user's data lives on one shard,
// and the shard key decides which:
// - name: shards hold ranges of first letters (A–M, N–Z, ...).
// - signup: shards hold ranges of users in signup order, oldest on shard 1.
// - hash: the user id, scrambled; shards split the scrambled range evenly.
//
// Newer users are the most active, so signup order puts the busiest users
// together on the last shard. First letters are uneven too (lots of A, J, M,
// S; hardly any Q, X, Z). Only the hash spreads users evenly.
//
// Edge cases: a celebrity whom a big share of all requests are about (so
// their one shard runs hot whatever the key), optionally cached at the app
// servers; and a dead shard, which fails only its own users' requests.

import { FlowSim, type FlowNode, type Job } from '../../core/flow/engine'
import { Worker } from '../../core/flow/nodes'
import type { ShardingState, ShardKey } from './types'
import { MAX_SHARDS, shardKey, TICKS_PER_SECOND } from './world'

export type Kind = 'read' | 'write'

export const USER_COUNT = 1000
const LETTERS = 26
// How common each first letter is, A–Z, roughly as for English first names.
const LETTER_WEIGHTS = [7, 4, 7, 6, 4, 1.5, 2.5, 2, 0.5, 11, 6, 5.5, 10, 2.5, 0.5, 1.5, 0.1, 5, 8, 5, 0.1, 1, 1.5, 0.05, 0.3, 0.5]
const WRITE_SHARE = 0.3
const CELEBRITY_SHARE = 0.35 // of all requests, once the celebrity joins
const CELEBRITY_WRITES = 0.05 // mostly people reading their posts
const WORK = 12
export const LINK_TICKS = { usersApp: 8, appShard: 6 }
const WINDOW = TICKS_PER_SECOND * 5

// How active each user is: a steady trickle from everyone, far more from the
// newest signups. Users are numbered in signup order.
const WEIGHTS = Array.from({ length: USER_COUNT }, (_, i) => 0.15 + Math.pow(i / (USER_COUNT - 1), 3))
let sum = 0
const CUMULATIVE = WEIGHTS.map((w) => (sum += w))
const TOTAL = sum

function pickUser(rng: () => number) {
  const r = rng() * TOTAL
  let lo = 0
  let hi = USER_COUNT - 1
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (CUMULATIVE[mid] > r) hi = mid
    else lo = mid + 1
  }
  return lo
}

// A user id scrambled into a random-looking number in [0, 1) (murmur3's
// finaliser). Different salts give unrelated numbers.
function scramble(user: number, salt: number) {
  let h = user + 1 + salt
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b)
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35)
  return ((h ^ (h >>> 16)) >>> 0) / 2 ** 32
}

// Each user's first letter, 0–25, at real-life frequencies, and nothing to do
// with when they signed up.
let letterSum = 0
const LETTER_CUMULATIVE = LETTER_WEIGHTS.map((w) => (letterSum += w))
const LETTER_OF = Array.from({ length: USER_COUNT }, (_, u) => {
  const r = scramble(u, 0) * letterSum
  return LETTER_CUMULATIVE.findIndex((c) => c > r)
})

// Even ranges of `size` things over n shards: shard i gets [first, last].
const range = (i: number, n: number, size: number) => [Math.ceil((i * size) / n), Math.ceil(((i + 1) * size) / n) - 1]

export function shardOf(user: number, n: number, key: ShardKey) {
  if (key === 'signup') return Math.floor((user * n) / USER_COUNT)
  if (key === 'name') return Math.floor((LETTER_OF[user] * n) / LETTERS)
  return user % n // ids interleave signup order, so this spreads new and old users evenly
}

// The celebrity: an ordinary user who lands on shard 3 of 4 by hash.
export const CELEBRITY = Array.from({ length: USER_COUNT }, (_, u) => u).find((u) => shardOf(u, 4, 'hash') === 2)!

// What shard i of n holds, as a label: "A–M", "#1–500" or "1 in 2".
export function holdsOf(i: number, n: number, key: ShardKey) {
  if (key === 'hash') return `1 in ${n}`
  if (key === 'signup') {
    const [first, last] = range(i, n, USER_COUNT)
    return `#${first + 1}–${last + 1}`
  }
  const [first, last] = range(i, n, LETTERS).map((l) => String.fromCharCode(65 + l))
  return first === last ? first : `${first}–${last}`
}

class Users implements FlowNode {
  alive = true
  rate = 0 // requests per tick
  readonly key = 'users'
  private carry = 0
  private sim: ShardingSim

  constructor(sim: ShardingSim) {
    this.sim = sim
  }

  receive(job: Job, sim: FlowSim) {
    sim.complete(job)
  }

  emit(sim: FlowSim) {
    this.carry += this.rate
    while (this.carry >= 1) {
      this.carry -= 1
      const celebrity = this.sim.celebrity && sim.rng() < CELEBRITY_SHARE
      const job = sim.newJob(1, celebrity ? CELEBRITY : pickUser(sim.rng), this.key)
      this.sim.kindOf.set(job, sim.rng() < (celebrity ? CELEBRITY_WRITES : WRITE_SHARE) ? 'write' : 'read')
      this.sim.sent++
      sim.forward(job, this.key, 'app')
    }
  }
}

// The app servers: look up the user's shard and send the request there,
// unless it's a read the app's cache can answer.
class App implements FlowNode {
  alive = true
  readonly key = 'app'
  private sim: ShardingSim

  constructor(sim: ShardingSim) {
    this.sim = sim
  }

  receive(job: Job, flow: FlowSim) {
    const s = this.sim
    if (s.cached && job.key === CELEBRITY && s.kindOf.get(job) === 'read') return flow.complete(job)
    flow.forward(job, this.key, shardKey(shardOf(job.key ?? 0, s.count, s.key)))
  }
}

export interface ShardingMetrics {
  rps: number
  load: Record<string, number> // how busy each shard's slots were, 0–1
  maxLoad: number // the busiest shard in use
  minLoad: number // the quietest shard in use
  errorRate: number // percent of requests turned away
}

interface Sample {
  sent: number
  completed: number
  dropped: number
  busy: Record<string, number>
}

export class ShardingSim {
  readonly flow: FlowSim
  readonly shards: Worker[] = []
  readonly kindOf = new WeakMap<Job, Kind>()
  sent = 0
  count = 1
  key: ShardKey = 'name'
  celebrity = false
  cached = false
  down: number | null = null

  private users: Users
  private changedAt = 0
  private busy: Record<string, number> = {}
  private history: Sample[] = []

  constructor(rng: () => number = Math.random) {
    this.flow = new FlowSim(rng)
    this.users = this.flow.add(new Users(this))
    this.flow.add(new App(this))
    this.flow.link('users', 'app', LINK_TICKS.usersApp)
    for (let i = 0; i < MAX_SHARDS; i++) {
      const s = this.flow.add(new Worker(shardKey(i), { slots: 4, queueLimit: 8, workPerRequest: WORK }))
      this.flow.link('app', s.key, LINK_TICKS.appShard)
      this.busy[s.key] = 0
      this.shards.push(s)
    }
  }

  get tick() {
    return this.flow.tick
  }

  // The stats cover only time since the shards or the key last changed.
  get settled() {
    return this.flow.tick - this.changedAt >= WINDOW
  }

  apply(st: ShardingState) {
    this.users.rate = st.rps / TICKS_PER_SECOND
    if (st.shards !== this.count || st.key !== this.key) this.changedAt = this.flow.tick
    this.count = st.shards
    this.key = st.key
    this.celebrity = st.celebrity
    this.cached = st.cached
    if (st.down !== this.down) {
      if (this.down !== null) this.shards[this.down].alive = true
      this.down = st.down
      if (st.down !== null) {
        this.shards[st.down].alive = false
        this.flow.fail(shardKey(st.down))
      }
    }
  }

  step() {
    this.flow.step()
    for (const s of this.shards) this.busy[s.key] += s.active.length / s.slots
    this.history.push({
      sent: this.sent,
      completed: this.flow.stats.completed,
      dropped: this.flow.stats.dropped,
      busy: { ...this.busy },
    })
    if (this.history.length > WINDOW + 1) this.history.shift()
  }

  get metrics(): ShardingMetrics {
    const keys = Object.keys(this.busy)
    const load = Object.fromEntries(keys.map((k) => [k, 0]))
    const h = this.history
    const span = h.length - 1
    if (span <= 0) return { rps: 0, load, maxLoad: 0, minLoad: 0, errorRate: 0 }
    const a = h[0]
    const b = h[span]
    for (const k of keys) load[k] = (b.busy[k] - a.busy[k]) / span
    const used = Array.from({ length: this.count }, (_, i) => i).filter((i) => i !== this.down).map((i) => load[shardKey(i)])
    const done = b.completed - a.completed
    const dropped = b.dropped - a.dropped
    return {
      rps: ((b.sent - a.sent) * TICKS_PER_SECOND) / span,
      load,
      maxLoad: Math.max(...used),
      minLoad: Math.min(...used),
      errorRate: done + dropped === 0 ? 0 : (dropped / (done + dropped)) * 100,
    }
  }
}
