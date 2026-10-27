import { TICKS_PER_SECOND } from '../../core/build/run'
import type { BuildTask, Placement } from '../../core/build/types'
import { FlowSim, type FlowNode, type Job } from '../../core/flow/engine'
import { Router, Source, Worker } from '../../core/flow/nodes'

// Build it: 18 req/s, write-heavy, and a celebrity about a third of them are
// about. One pad in front of the data, four data pads in a column. Nothing
// says what goes where:
//   - Databases on the data pads are shards: each user lives on one, picked
//     by a hash of their id. The app sends each request to its user's shard.
//   - A read replica copies the database above it (or, with none above, the
//     nearest one below) and takes a share of that shard's reads. Writes all
//     still land on the database, so replicas alone never keep up.
//   - A load balancer in front sends requests to any data piece at random,
//     mostly ones that don't hold that user: errors.
//   - A cache in front answers the celebrity's reads. Without it, the
//     celebrity's shard drowns however many shards there are.
// Winning takes the cache plus enough shards (three, or two with a replica
// each).

const RPS = 18
const USERS = 1000
const CELEBRITY = USERS // a user id of their own
const CELEBRITY_SHARE = 0.35
const CELEBRITY_WRITES = 0.1
const WRITE_SHARE = 0.5
const DATA_Z = [-3.9, -1.3, 1.3, 3.9]
const DATA_X = 2.6

const dataPads = DATA_Z.map((_, i) => `data-${i}`)

type Kind = 'read' | 'write'

// A well-mixed hash (murmur3's finaliser), so ids spread evenly.
function hash(n: number) {
  let h = n + 1
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b)
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35)
  return (h ^ (h >>> 16)) >>> 0
}

// The data tier as placed: which pads are shards, and which shard each
// replica copies.
function layout(placed: Placement) {
  const shards = dataPads.filter((id) => placed[id] === 'database')
  const copyOf = new Map<string, string>()
  dataPads.forEach((id, i) => {
    if (placed[id] !== 'replica') return
    const above = dataPads.slice(0, i).reverse().find((p) => placed[p] === 'database')
    const below = dataPads.slice(i + 1).find((p) => placed[p] === 'database')
    const source = above ?? below
    if (source) copyOf.set(id, source)
  })
  return { shards, copyOf }
}

// Users sending reads and writes, a third of them about the celebrity.
class Users extends Source {
  private owed = 0
  private kindOf: WeakMap<Job, Kind>

  constructor(kindOf: WeakMap<Job, Kind>) {
    super('users')
    this.rate = RPS / TICKS_PER_SECOND
    this.kindOf = kindOf
  }

  emit(sim: FlowSim) {
    this.owed += this.rate
    while (this.owed >= 1) {
      this.owed -= 1
      const celebrity = sim.rng() < CELEBRITY_SHARE
      const job = sim.newJob(1, celebrity ? CELEBRITY : Math.floor(sim.rng() * USERS), this.key)
      this.kindOf.set(job, sim.rng() < (celebrity ? CELEBRITY_WRITES : WRITE_SHARE) ? 'write' : 'read')
      sim.forward(job, this.key, 'app')
    }
  }
}

// Sends each request on, instantly: `route` picks where. A cache answers the
// celebrity's reads itself.
class KeyRouter implements FlowNode {
  alive = true
  readonly key: string
  private route: (job: Job) => string | undefined
  private answers?: (job: Job) => boolean

  constructor(key: string, route: (job: Job) => string | undefined, answers?: (job: Job) => boolean) {
    this.key = key
    this.route = route
    this.answers = answers
  }

  receive(job: Job, sim: FlowSim) {
    if (this.answers?.(job)) return sim.complete(job)
    const to = this.route(job)
    if (to) sim.forward(job, this.key, to)
    else sim.drop(job, this.key)
  }
}

// A database or replica: turns away requests for users it doesn't hold.
class DataNode extends Worker {
  private holds: (job: Job) => boolean

  constructor(key: string, holds: (job: Job) => boolean) {
    super(key, { slots: 4, queueLimit: 8, workPerRequest: 12 })
    this.holds = holds
  }

  receive(job: Job, sim: FlowSim) {
    if (!this.holds(job)) return sim.drop(job, this.key)
    super.receive(job, sim)
  }
}

export const CELEBRITY_LAUNCH: BuildTask = {
  title: 'Build it: the celebrity signs up.',
  sub: 'Lots of writes, and one very popular user. Choose your pieces: a read replica copies the database above it.',
  brief: [
    'A celebrity just signed up. Your app handles 18 requests a second, half of them writes, and about a third of everything is about this one user.',
    'One database can’t keep up. You can split users across several databases (shards), each holding a share of them. A read replica copies a shard and takes some of its reads, but every write still lands on the shard itself.',
    'A load balancer sends requests to any database at random, and most databases don’t hold that user. A cache in front can answer repeated reads without touching a database.',
    'Your job: serve all the traffic with under 1% errors and no database over 85% busy. Look at which database gets the celebrity.',
  ],
  goal: 'Serve 18 req/s with under 1% errors and no database over 85% busy.',
  win: 'Shards share the writes, and a cache takes the one user no shard key can split.',
  replies: () => true,
  holdSeconds: 6,
  rps: RPS,
  shot: { target: [-1.2, 0.7, 0], zoom: 0.8 },
  fixed: [
    { id: 'users', kind: 'users', x: -7, z: 0 },
    { id: 'app', kind: 'app', x: -3.8, z: 0 },
  ],
  pads: [
    { id: 'front', x: -0.6, z: 0, accepts: ['cache', 'balancer'] },
    ...DATA_Z.map((z, i) => ({ id: dataPads[i], x: DATA_X, z, accepts: ['database' as const, 'replica' as const] })),
  ],
  toolbox: [
    { kind: 'database', count: 3 },
    { kind: 'replica', count: 3 },
    { kind: 'cache', count: 1 },
    { kind: 'balancer', count: 1 },
  ],
  watch: [{ kind: 'busy', key: '', label: 'Busiest database' }],

  assemble(placed, _settings, rng) {
    const flow = new FlowSim(rng)
    const kindOf = new WeakMap<Job, Kind>()
    const { shards, copyOf } = layout(placed)
    const shardOf = (job: Job) => (shards.length ? shards[hash(job.key ?? 0) % shards.length] : undefined)
    const copiesOf = (shard: string) => [shard, ...[...copyOf].filter(([, s]) => s === shard).map(([r]) => r)]

    // Writes to the user's shard; reads to the shard or its replicas, in turn.
    let turn = 0
    const route = (job: Job) => {
      const shard = shardOf(job)
      if (!shard || kindOf.get(job) === 'write') return shard
      const copies = copiesOf(shard)
      return copies[turn++ % copies.length]
    }

    flow.add(new Users(kindOf))
    flow.link('users', 'app', 8)

    // Each data piece holds only its own shard's users; a replica only answers reads.
    const data = dataPads.filter((id) => placed[id])
    for (const id of data) {
      const holds =
        placed[id] === 'database'
          ? (job: Job) => shardOf(job) === id
          : (job: Job) => kindOf.get(job) === 'read' && copyOf.get(id) === shardOf(job)
      flow.add(new DataNode(id, holds))
    }

    const front = placed.front
    if (front === 'balancer') flow.add(new Router('front')).algorithm = 'random'
    if (front === 'cache') flow.add(new KeyRouter('front', route, (job) => job.key === CELEBRITY && kindOf.get(job) === 'read'))
    if (front) {
      flow.add(new KeyRouter('app', () => 'front'))
      flow.link('app', 'front', 5)
      for (const id of data) flow.link('front', id, 6)
    } else {
      flow.add(new KeyRouter('app', route))
      for (const id of data) flow.link('app', id, 10)
    }
    return flow
  },

  check: (m, placed) => dataPads.some((id) => placed[id] === 'database') && m.dropRate < 1 && m.busiest < 0.85,
}
