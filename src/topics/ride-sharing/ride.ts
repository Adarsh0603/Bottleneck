import { FlowSim, type FlowNode, type Job } from '../../core/flow/engine'
import { SECOND, TICKS_PER_SECOND } from '../../core/flow/time'

// A ride-hailing service, as a running system. Two streams run at once:
//   drivers → (road) → live map or trips database: a location ping every few seconds, thousands a second
//   riders → (front) → map shard → dispatch → (back) → trips: a ride request, matched to the nearest free car
// Every piece is optional, so a bad design shows how it fails: a stale map, a hot city centre,
// two riders sent the same car, or requests lost when dispatch crashes.

export { SECOND, TICKS_PER_SECOND }

const SERVE = 8 // lookups a second one map shard answers
const OFFER = SECOND // ticks a driver takes to answer an offer
const CLAIM = 2 // ticks to claim a car before offering it
const WRITE = 3 // ticks to save a trip
const DB_PINGS = 500 // pings a second the trips database can write
const LIVE_PINGS = 50_000 // pings a second the live map can take
const PATIENCE = 10 * SECOND // a rider cancels after waiting this long for a lookup
const DOT = 200 // pings drawn as one dot
const LIMIT = 10 // rides a second a limiter in front lets through
const WINDOW = 200 // matched rides the average wait is taken over

export interface Phase {
  from: number // tick
  pings: number // location pings a second
  rides: number // ride requests a second
  downtown: number // share of requests that come from the busy centre
}

export interface Config {
  front: { key: string; kind: 'pass' | 'queue' | 'limiter' | 'jam' }[] // in front of the map shards, in order
  map?: string // the map server, when one stands in front of dispatch; dispatch holds the whole map itself otherwise
  shards: number // parts the map is cut into
  back: { key: string; kind: 'pass' | 'jam' }[] // between dispatch and the trips database, in order
  road: { key: string; kind: 'pass' | 'jam' }[] // on the drivers' road before the live map, in order
  live?: string // the live map, when one stands on the drivers' road
  pings: 0 | 1 // the pings go to the trips database, or to the live map
  claim: boolean // a car is claimed before it is offered
  split: 0 | 1 // the map is cut by fixed cells, or by how busy an area is
  log: boolean // requests are written to a queue first and replayed after a crash
  clash: boolean // two riders can be offered the same car
  phases: Phase[]
  crash?: { at: number; down: number }
}

interface Match {
  job: Job
  ready: number
  rank: number
}

// Where requests start, and where the day's clock runs.
class Riders implements FlowNode {
  alive = true
  readonly key = 'riders'
  private ride: Ride
  constructor(ride: Ride) {
    this.ride = ride
  }
  receive() {}
  emit(sim: FlowSim) {
    this.ride.step(sim)
  }
}

// Drivers sending their location. Each dot stands for a few hundred pings.
class Drivers implements FlowNode {
  alive = true
  readonly key = 'drivers'
  private ride: Ride
  private due = 0
  constructor(ride: Ride) {
    this.ride = ride
  }
  receive() {}
  emit(sim: FlowSim) {
    const phase = this.ride.phaseAt(sim.tick)
    if (phase) this.due += phase.pings / SECOND / DOT
    for (; this.due >= 1; this.due--) this.ride.ping(sim)
  }
}

// A part on the road: passes everything on, unless it is a limiter or stands where it cannot work.
class Gate implements FlowNode {
  alive = true
  readonly key: string
  private ride: Ride
  private kind: 'pass' | 'queue' | 'limiter' | 'jam'
  private tokens = LIMIT
  private last = 0
  constructor(key: string, kind: 'pass' | 'queue' | 'limiter' | 'jam', ride: Ride) {
    this.key = key
    this.kind = kind
    this.ride = ride
  }
  receive(job: Job, sim: FlowSim) {
    if (this.kind === 'jam') return sim.drop(job, this.key)
    if (this.kind === 'limiter' && job.from === 'ride') {
      this.tokens = Math.min(LIMIT, this.tokens + ((sim.tick - this.last) * LIMIT) / SECOND)
      this.last = sim.tick
      if (this.tokens < 1) {
        this.ride.limited++
        return sim.drop(job, this.key)
      }
      this.tokens--
    }
    if (this.kind === 'queue' && job.from === 'ride' && this.ride.cfg.log) job.via = 'logged'
    this.ride.onward(job, this.key, sim)
  }
}

// The map server: holds the cars of the whole map, cut into shards, and answers lookups for each.
class MapServer implements FlowNode {
  alive = true
  readonly key: string
  private ride: Ride
  constructor(key: string, ride: Ride) {
    this.key = key
    this.ride = ride
  }
  receive(job: Job) {
    this.ride.enqueue(job)
  }
  load() {
    return this.ride.queues.reduce((a, q) => a + q.length, 0)
  }
}

// Matches a rider with a car. The first map shard lives inside it.
class Dispatch implements FlowNode {
  alive = true
  readonly key = 'dispatch'
  private ride: Ride
  constructor(ride: Ride) {
    this.ride = ride
  }
  receive(job: Job, sim: FlowSim) {
    if (job.from !== 'ride') return
    if (job.attempts === 1) this.ride.startMatch(job, sim)
    else this.ride.enqueue(job)
  }
  load() {
    return this.ride.matching.length + (this.ride.cfg.map ? 0 : this.ride.queues[0].length)
  }
}

// Takes the end of both streams: the live map and the trips database.
class Store implements FlowNode {
  alive = true
  readonly key: string
  private writes: { job: Job; due: number }[] = []
  private ride: Ride
  constructor(key: string, ride: Ride) {
    this.key = key
    this.ride = ride
  }
  receive(job: Job, sim: FlowSim) {
    if (job.from === 'ride') this.writes.push({ job, due: sim.tick + WRITE })
  }
  process(sim: FlowSim) {
    const later: typeof this.writes = []
    for (const w of this.writes) {
      if (sim.tick < w.due) later.push(w)
      else this.ride.saved(w.job, sim)
    }
    this.writes = later
  }
  load() {
    return this.writes.length
  }
}

// Tells the system when something was thrown away on its way.
class Net extends FlowSim {
  onLoss?: (job: Job) => void
  drop(job: Job, node: string) {
    super.drop(job, node)
    this.onLoss?.(job)
  }
}

export class Ride {
  readonly flow: Net
  readonly cfg: Config
  readonly queues: Job[][] = []
  matching: Match[] = []
  limited = 0 // riders a limiter turned away
  down = false
  claimed = 0 // cars claimed before they were offered
  private tokens: number[] = []
  private replay: Job[] = []
  private taken: { area: number; rank: number; until: number }[] = []
  private waits: number[] = []
  private backlog = 0
  private failedN = 0
  private doublesN = 0
  private matchedN = 0
  private hit = 0
  private lost = 0
  private rr = 0
  private rrDown = 0
  private views = 0
  private shardOf = new Map<number, number>()
  private dtAcc = 0
  private due = 0

  constructor(rng: () => number, cfg: Config) {
    this.cfg = cfg
    const flow = (this.flow = new Net(rng))
    flow.onLoss = (job) => {
      if (job.from === 'ride') this.failedN++
    }
    flow.traffic = () => this.phaseAt(flow.tick)?.rides ?? 0
    flow.add(new Riders(this))
    flow.add(new Drivers(this))
    flow.add(new Dispatch(this))
    flow.add(new Store('trips', this))
    for (let i = 0; i < cfg.shards; i++) {
      this.queues.push([])
      this.tokens.push(0)
    }
    if (cfg.map) flow.add(new MapServer(cfg.map, this))
    for (const g of [...cfg.front, ...cfg.back, ...cfg.road]) flow.add(new Gate(g.key, g.kind, this))
    if (cfg.live) flow.add(new Store(cfg.live, this))

    const front = cfg.front.map((f) => f.key)
    ;['riders', ...front].forEach((key, i, all) => i > 0 && flow.link(all[i - 1], key, 2))
    flow.link(front.length ? front[front.length - 1] : 'riders', this.lookups(), 2)
    if (cfg.map) flow.link(cfg.map, 'dispatch', 2)
    ;['dispatch', ...cfg.back.map((b) => b.key), 'trips'].forEach((key, i, all) => i > 0 && flow.link(all[i - 1], key, 2))
    const road = cfg.road.map((r) => r.key)
    // Both ends stay drawn, so the choice between them is visible: the setting decides which one the pings use.
    const roadEnd = road.length ? road[road.length - 1] : 'drivers'
    ;['drivers', ...road].forEach((key, i, all) => i > 0 && flow.link(all[i - 1], key, 2))
    for (const end of new Set(['trips', ...(cfg.live ? [cfg.live] : [])])) {
      flow.link(roadEnd, end, 2)
      // Dispatch reads cars from wherever the positions are kept, and the rider's screen shows them.
      flow.link('dispatch', end, 2)
      flow.link(end, 'riders', 4)
    }
  }

  // Where the pings end up: the live map when it stands on the road, else the trips database.
  private sink() {
    return this.cfg.pings === 1 && this.cfg.live ? this.cfg.live : 'trips'
  }

  // Where lookups are answered: the map server, or dispatch itself.
  private lookups() {
    return this.cfg.map ?? 'dispatch'
  }

  phaseAt(tick: number) {
    return [...this.cfg.phases].reverse().find((p) => p.from <= tick)
  }

  // --- Moving requests --------------------------------------------------------

  // The part a request goes to after `from`.
  onward(job: Job, from: string, sim: FlowSim) {
    const { front, back, road } = this.cfg
    const order = (list: { key: string }[]) => list.map((l) => l.key)
    const f = order(front).indexOf(from)
    if (f >= 0) return f + 1 < front.length ? sim.forward(job, from, front[f + 1].key) : this.toShard(job, from, sim)
    const chain = order(back)
    const b = chain.indexOf(from)
    if (b >= 0) return sim.forward(job, from, chain[b + 1] ?? 'trips')
    const r = order(road).indexOf(from)
    if (r >= 0) sim.forward(job, from, road[r + 1]?.key ?? this.sink())
  }

  private toShard(job: Job, from: string, sim: FlowSim) {
    const n = this.queues.length
    // Cut by fixed cells, the centre always lands on the same shard. Cut by load, every shard gets its share.
    const i = this.cfg.split === 1 ? this.rr++ % n : job.key === 1 || n === 1 ? 0 : 1 + (this.rrDown++ % (n - 1))
    this.shardOf.set(job.id, i)
    sim.forward(job, from, this.lookups())
  }

  enqueue(job: Job) {
    this.queues[this.shardOf.get(job.id) ?? 0].push(job)
  }

  ping(sim: FlowSim) {
    const job = sim.newJob(1, undefined, 'ping')
    const first = this.cfg.road[0]?.key ?? this.sink()
    sim.forward(job, 'drivers', first)
  }

  // --- The day ------------------------------------------------------------------

  step(sim: FlowSim) {
    const phase = this.phaseAt(sim.tick)
    const { crash } = this.cfg
    if (phase) {
      this.backlog = Math.max(0, this.backlog + (phase.pings - this.cap()) / SECOND)
      this.due += phase.rides / SECOND
      for (; this.due >= 1; this.due--) this.newRide(sim, phase)
    }
    if (phase && sim.tick % 10 === 0) this.show(sim)
    if (crash?.at === sim.tick) this.crash(sim)
    if (crash && sim.tick === crash.at + crash.down) this.restart(sim)
    this.serve(sim)
    this.finish(sim)
    this.taken = this.taken.filter((t) => t.until > sim.tick)
  }

  // The map on a rider's screen refreshes from wherever the positions are kept, unless that has fallen behind.
  private show(sim: FlowSim) {
    if (this.lag() > 2 || this.cap() === 0) return
    sim.forward(sim.newJob(1, undefined, 'view'), this.sink(), 'riders')
  }

  // Pings a second the place they go to can write.
  private cap() {
    if (this.cfg.road.some((r) => r.kind === 'jam')) return 0
    return this.sink() === 'trips' ? DB_PINGS : LIVE_PINGS
  }

  // Seconds of pings waiting to be written: how old the map is.
  lag() {
    return this.backlog / DB_PINGS
  }

  private newRide(sim: FlowSim, phase: Phase) {
    this.dtAcc += phase.downtown
    const centre = this.dtAcc >= 1
    if (centre) this.dtAcc--
    const job = sim.newJob(1, centre ? 1 : 0, 'ride')
    if (this.cfg.front.length) sim.forward(job, 'riders', this.cfg.front[0].key)
    else this.toShard(job, 'riders', sim)
  }

  // Each shard answers its lookups, slower the staler the map is. Nothing is answered while dispatch is down.
  private serve(sim: FlowSim) {
    const rate = SERVE / (1 + this.lag() / 2)
    this.queues.forEach((q, i) => {
      const keep = q.filter((j) => {
        if (sim.tick - j.createdAt < PATIENCE) return true
        sim.drop(j, this.lookups())
        return false
      })
      q.length = 0
      q.push(...keep)
      if (this.down) return
      this.tokens[i] = Math.min(rate, this.tokens[i] + rate / SECOND)
      while (this.tokens[i] >= 1 && q.length) {
        this.tokens[i]--
        const job = q.shift()!
        job.attempts = 1
        if (++this.views % 3 === 0) sim.forward(sim.newJob(1, undefined, 'read'), 'dispatch', this.sink())
        this.shardOf.delete(job.id)
        if (this.cfg.map) sim.forward(job, this.cfg.map, 'dispatch')
        else this.startMatch(job, sim)
      }
    })
  }

  // Dispatch picks the nearest free car and offers the ride. Without a claim, riders in the
  // same area at the same moment all see the same car as nearest.
  startMatch(job: Job, sim: FlowSim) {
    if (this.down) return void (job.via === 'logged' ? this.replay.push(job) : sim.drop(job, 'dispatch'))
    const area = job.key ?? 0
    let rank = 0
    if (this.cfg.claim) {
      while (this.taken.some((t) => t.area === area && t.rank === rank)) rank++
      this.claimed++
    } else if (this.cfg.clash && this.taken.some((t) => t.area === area && t.rank === 0)) {
      job.msg = -1
    }
    this.taken.push({ area, rank, until: sim.tick + OFFER })
    this.matching.push({ job, rank, ready: sim.tick + OFFER + (this.cfg.claim ? CLAIM : 0) })
  }

  private finish(sim: FlowSim) {
    const rest: Match[] = []
    for (const m of this.matching) {
      if (sim.tick < m.ready) rest.push(m)
      else {
        if (m.job.msg === -1) this.doublesN++
        sim.forward(m.job, 'dispatch', this.cfg.back[0]?.key ?? 'trips')
      }
    }
    this.matching = rest
  }

  // The trip is saved: the rider has a car.
  saved(job: Job, sim: FlowSim) {
    this.matchedN++
    this.waits.push((sim.tick - job.createdAt) / SECOND)
    if (this.waits.length > WINDOW) this.waits.shift()
    sim.complete(job)
  }

  // Dispatch died: what it was matching is gone, unless it was written down first.
  private crash(sim: FlowSim) {
    this.down = true
    this.hit = this.matching.length
    for (const m of this.matching) {
      if (m.job.via === 'logged') this.replay.push(m.job)
      else {
        this.lost++
        sim.drop(m.job, 'dispatch')
      }
    }
    this.matching = []
    this.taken = []
  }

  private restart(sim: FlowSim) {
    this.down = false
    for (const job of this.replay.splice(0)) this.startMatch(job, sim)
  }

  // --- What the checks read -----------------------------------------------------

  // Riders sent a car that was already offered to someone else.
  doubles() {
    return this.doublesN
  }

  failed() {
    return this.failedN
  }

  matchedCount() {
    return this.matchedN
  }

  // Seconds an average rider waited for a car, over the last few hundred.
  wait() {
    return this.waits.length === 0 ? 0 : this.waits.reduce((a, b) => a + b, 0) / this.waits.length
  }

  held() {
    return this.replay.length
  }

  crashLoss() {
    return { hit: this.hit, lost: this.lost }
  }

  // Requests waiting at the busiest map shard.
  busiest() {
    return Math.max(...this.queues.map((q) => q.length))
  }

  // Requests waiting at one map shard.
  waiting(index: number) {
    return this.queues[index]?.length ?? 0
  }
}
