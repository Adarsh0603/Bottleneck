import { FlowSim, type FlowNode, type Job } from '../../core/flow/engine'

// A key-value store, as a running system. Every operation takes this road:
//   client → (limiter) → (hot-key cache) → coordinator → (hash ring) → storage nodes
// The ring decides which N nodes hold a key. A write goes to all of them and is done
// once W have answered. A read asks R of them and takes the newest answer. Every piece
// is optional, so a bad design shows how it fails.

export const TICKS_PER_SECOND = 20
export const SECOND = TICKS_PER_SECOND

export const KEYS = 30 // keys in use; key 0 is the one everybody wants
export const HOT = 0
const WRITE_SHARE = 0.2
const COORD_SLOTS = 12
const COORD_LINE = 60
const COORD_WORK = 2
const NODE_SLOTS = 3
const NODE_LINE = 14
const READ_WORK = 3
const WRITE_WORK = 4
const LINK = 4
const GRACE = 20 // ticks after a write is acknowledged before an old answer counts as stale
const TIMEOUT = 3 * SECOND
const CACHE_TTL = 8 // ticks the hot-key cache may hold an answer; shorter than GRACE
const CACHE_CAP = 8
const ROUND = 6 // ticks a write spends asking for the current version first
const HINT_DELAY = 10 // ticks after a node returns before the hints it missed arrive
const LIMIT_RATE = 18 // operations a second a rate limiter lets through
const STREAM = 5 * SECOND // how long a new node takes to receive its keys
const CATCH_UP = 5 * SECOND // how long a returning node has to catch up
const SKEW = 4 * SECOND // how far ahead one node's clock runs

const EASY_TOKEN: Record<string, number> = { n1: 0.02, n2: 0.1, n3: 0.18, n4: 0.66, n5: 0.74 }
const GOLDEN = 0.6180339887
const SLICES = 8

export interface Phase {
  from: number // tick
  ops: number // per second
  hot?: number // share of operations that are for the hot key
}

export interface Limit {
  key: string
}

export interface Events {
  join?: { at: number } // the last node joins the ring, then receives its keys
  crash?: { at: number; down: number; node: number } // index of the node that goes down
  partition?: { at: number; until: number; far: number } // share of clients cut off with the last two nodes
  skew?: { from: number; node: number } // from then on this node's clock runs ahead
}

export interface Config {
  nodes: string[] // keys of the storage nodes, in order
  ring?: string
  cache?: string
  limits: Limit[]
  copies: number // N
  readQ: number // R
  writeQ: number // W
  handoff: boolean // a stand-in holds writes for a node that is down
  repair: boolean // a read fixes the old copies it finds
  slices: boolean // each node owns many small slices of the ring
  counter: boolean // versions come from a counter, not from clocks
  phases: Phase[]
  events: Events
  jam?: string[] // parts standing where requests cannot get through
}

export interface Tally {
  sent: number
  done: number // operations answered
  failed: number // operations turned away or timed out
  reads: number
  stale: number // reads that returned an older value than one written earlier
  hits: number // reads the hot-key cache answered
  limited: number // operations a rate limiter turned away
}

const blank = (): Tally => ({ sent: 0, done: 0, failed: 0, reads: 0, stale: 0, hits: 0, limited: 0 })

interface Version {
  stamp: number
  id: number // the write that made it
}

const newer = (a: Version, b?: Version) => !b || a.stamp > b.stamp || (a.stamp === b.stamp && a.id > b.id)

interface Op {
  job: Job
  kind: 'read' | 'write'
  key: number
  far: boolean
  need: number
  got: Version[]
  acks: number
  waiting: number // replica requests still out
  answered: string[]
}

interface Meta {
  op: number
  node: string
  kind: 'read' | 'write' | 'hint'
  version?: Version
  hintFor?: string
}

class Net extends FlowSim {
  onLoss?: (job: Job, node: string) => void
  drop(job: Job, node: string) {
    super.drop(job, node)
    this.onLoss?.(job, node)
  }
}

// The clients: they also run the script of the day.
class Clients implements FlowNode {
  alive = true
  readonly key = 'clients'
  private kv: Kv
  private due = 0
  constructor(kv: Kv) {
    this.kv = kv
  }
  receive() {}
  emit(sim: FlowSim) {
    this.kv.script(sim)
    const phase = this.kv.phaseAt(sim.tick)
    if (phase) this.due += phase.ops / SECOND
    for (; this.due >= 1; this.due--) this.kv.start(sim)
  }
}

class Jam implements FlowNode {
  alive = true
  readonly key: string
  constructor(key: string) {
    this.key = key
  }
  receive(job: Job, sim: FlowSim) {
    sim.drop(job, this.key)
  }
}

class Limiter implements FlowNode {
  alive = true
  readonly key: string
  private kv: Kv
  private tokens = LIMIT_RATE
  private last = 0
  constructor(limit: Limit, kv: Kv) {
    this.key = limit.key
    this.kv = kv
  }
  receive(job: Job, sim: FlowSim) {
    this.tokens = Math.min(LIMIT_RATE, this.tokens + ((sim.tick - this.last) * LIMIT_RATE) / SECOND)
    this.last = sim.tick
    if (this.tokens < 1) {
      this.kv.tally.limited++
      return sim.drop(job, this.key)
    }
    this.tokens--
    this.kv.pass(job, this.key, sim)
  }
}

// Keeps the answer to a read for a moment, so a hot key does not reach the nodes every time.
class HotCache implements FlowNode {
  alive = true
  readonly key: string
  private kv: Kv
  private seen = new Map<number, { version?: Version; at: number }>()
  constructor(key: string, kv: Kv) {
    this.key = key
    this.kv = kv
  }
  receive(job: Job, sim: FlowSim) {
    const hit = job.from === 'op' && this.kv.isRead(job) ? this.seen.get(job.key!) : undefined
    if (hit && sim.tick - hit.at < CACHE_TTL) {
      this.kv.tally.hits++
      return this.kv.answered(job, hit.version, sim)
    }
    if (!this.kv.isRead(job)) this.seen.delete(job.key!)
    this.kv.pass(job, this.key, sim)
  }
  fill(key: number, version: Version | undefined, tick: number) {
    this.seen.delete(key)
    this.seen.set(key, { version, at: tick })
    if (this.seen.size > CACHE_CAP) this.seen.delete(this.seen.keys().next().value!)
  }
}

// Takes a few jobs at a time.
class Coordinator implements FlowNode {
  alive = true
  readonly key = 'coord'
  private active: Job[] = []
  private queue: Job[] = []
  private kv: Kv
  constructor(kv: Kv) {
    this.kv = kv
  }
  receive(job: Job, sim: FlowSim) {
    if (this.queue.length >= COORD_LINE) return sim.drop(job, this.key)
    job.remaining = job.work
    this.queue.push(job)
  }
  process(sim: FlowSim) {
    while (this.active.length < COORD_SLOTS && this.queue.length) this.active.push(this.queue.shift()!)
    const left: Job[] = []
    for (const job of this.active) {
      if (--job.remaining > 0) left.push(job)
      else this.kv.dispatch(job, sim)
    }
    this.active = left
  }
  load() {
    return this.active.length + this.queue.length
  }
}

// Passes a request to the node it is meant for.
class RingPiece implements FlowNode {
  alive = true
  readonly key: string
  constructor(key: string) {
    this.key = key
  }
  receive(job: Job, sim: FlowSim) {
    sim.forward(job, this.key, job.via!)
  }
}

// A storage node: serves a few requests at a time, and keeps the newest version of each key.
export class Storage implements FlowNode {
  alive = true
  readonly key: string
  readonly data = new Map<number, Version>()
  private active: Job[] = []
  private queue: Job[] = []
  private kv: Kv
  constructor(key: string, kv: Kv) {
    this.key = key
    this.kv = kv
  }
  receive(job: Job, sim: FlowSim) {
    if (!this.alive || this.queue.length >= NODE_LINE) return sim.drop(job, this.key)
    job.remaining = job.work
    this.queue.push(job)
  }
  process(sim: FlowSim) {
    while (this.active.length < NODE_SLOTS && this.queue.length) this.active.push(this.queue.shift()!)
    const left: Job[] = []
    for (const job of this.active) {
      if (--job.remaining > 0) left.push(job)
      else this.kv.served(job, this, sim)
    }
    this.active = left
  }
  load() {
    return this.active.length + this.queue.length
  }
  lose() {
    const lost = [...this.active, ...this.queue]
    this.active = []
    this.queue = []
    return lost
  }
  apply(key: number, version: Version) {
    if (newer(version, this.data.get(key))) this.data.set(key, version)
  }
}

export class Kv {
  readonly flow: Net
  readonly cfg: Config
  readonly tally = blank()
  readonly stores: Storage[] = []
  private cache?: HotCache
  private front: string[] = []
  private ops = new Map<number, Op>()
  private metas = new Map<number, Meta>()
  private truth = new Map<number, { id: number; at: number }>()
  private hints: { node: string; key: number; version: Version }[] = []
  private later: { at: number; job: Job }[] = []
  private recovered = -1
  atRecovery?: number // copies out of date a few seconds after the crashed node came back

  constructor(rng: () => number, cfg: Config) {
    this.cfg = cfg
    const flow = (this.flow = new Net(rng))
    flow.onLoss = (job) => this.lose(job)
    flow.traffic = () => this.phaseAt(flow.tick)?.ops ?? 0
    flow.add(new Clients(this))
    for (const l of cfg.limits) {
      flow.add(new Limiter(l, this))
      this.front.push(l.key)
    }
    if (cfg.cache) {
      this.front.push(cfg.cache)
      if (cfg.jam?.includes(cfg.cache)) flow.add(new Jam(cfg.cache))
      else this.cache = flow.add(new HotCache(cfg.cache, this))
    }
    flow.add(new Coordinator(this))
    this.front.forEach((key, i) => flow.link(i === 0 ? 'clients' : this.front[i - 1], key, LINK))
    flow.link(this.front.length ? this.front[this.front.length - 1] : 'clients', 'coord', LINK)
    if (cfg.ring) {
      if (cfg.jam?.includes(cfg.ring)) flow.add(new Jam(cfg.ring))
      else flow.add(new RingPiece(cfg.ring))
      flow.link('coord', cfg.ring, LINK)
    }
    for (const key of cfg.nodes) {
      const store = flow.add(new Storage(key, this))
      this.stores.push(store)
      flow.link(cfg.ring ?? 'coord', key, LINK)
    }
  }

  phaseAt(tick: number) {
    return [...this.cfg.phases].reverse().find((p) => p.from <= tick)
  }

  // --- The ring ------------------------------------------------------------------------

  private joiner() {
    return this.cfg.events.join ? this.stores[this.stores.length - 1] : undefined
  }

  // The nodes on the ring right now.
  members() {
    const j = this.joiner()
    return j && this.flow.tick < this.cfg.events.join!.at ? this.stores.filter((s) => s !== j) : this.stores
  }

  private tokens(members: Storage[]) {
    const out: { pos: number; node: Storage }[] = []
    for (const node of members) {
      // Slices of every node are spread by the golden ratio, so any number of nodes share the ring about evenly.
      const j = this.stores.indexOf(node)
      if (this.cfg.slices) for (let i = 0; i < SLICES; i++) out.push({ pos: ((j * SLICES + i) * GOLDEN) % 1, node })
      else out.push({ pos: EASY_TOKEN[node.key] ?? 0.5, node })
    }
    return out.sort((a, b) => a.pos - b.pos)
  }

  // The nodes that hold a key, in order: the first `count` distinct ones clockwise from it.
  walk(key: number, count: number) {
    const members = this.members()
    const ring = this.tokens(members)
    const at = (key * 0.7548776662 + 0.1234) % 1
    let i = ring.findIndex((t) => t.pos >= at)
    if (i < 0) i = 0
    const out: Storage[] = []
    for (let n = 0; n < ring.length && out.length < Math.min(count, members.length); n++) {
      const node = ring[(i + n) % ring.length].node
      if (!out.includes(node)) out.push(node)
    }
    return out
  }

  // How the key space is shared out, as a share of keys per node.
  share() {
    const out = new Map<string, number>()
    for (const s of this.members()) out.set(s.key, 0)
    for (let k = 0; k < KEYS; k++) {
      const first = this.walk(k, 1)[0]
      if (first) out.set(first.key, (out.get(first.key) ?? 0) + 1 / KEYS)
    }
    return out
  }

  private replicas() {
    return Math.max(1, Math.min(this.cfg.copies, this.members().length))
  }

  // --- The day's script ----------------------------------------------------------------

  private far() {
    return this.members().slice(-2)
  }

  private partitioned(tick: number) {
    const p = this.cfg.events.partition
    return !!p && tick >= p.at && tick < p.until
  }

  private reachable(node: Storage, far: boolean, tick: number) {
    if (!node.alive) return false
    if (!this.partitioned(tick)) return true
    return this.far().includes(node) === far
  }

  script(sim: FlowSim) {
    const { crash, join } = this.cfg.events
    const node = crash ? this.stores[Math.min(crash.node, this.stores.length - 1)] : undefined
    if (crash && node && sim.tick === crash.at) {
      node.alive = false
      sim.fail(node.key)
    }
    if (crash && node && sim.tick === crash.at + crash.down) {
      node.alive = true
      this.recovered = sim.tick + HINT_DELAY
    }
    if (crash && sim.tick === crash.at + crash.down + CATCH_UP) this.atRecovery = this.diverged()
    if (this.recovered === sim.tick && node) {
      for (const h of this.hints.filter((x) => x.node === node.key)) node.apply(h.key, h.version)
      this.hints = this.hints.filter((x) => x.node !== node.key)
    }
    const j = this.joiner()
    if (join && j && sim.tick === join.at + STREAM) {
      for (let k = 0; k < KEYS; k++) {
        if (!this.walk(k, this.replicas()).includes(j)) continue
        for (const s of this.stores) {
          const v = s.data.get(k)
          if (s !== j && v) j.apply(k, v)
        }
      }
    }
    this.later = this.later.filter((l) => {
      if (l.at > sim.tick) return true
      this.go(l.job, sim)
      return false
    })
    for (const [id, op] of this.ops) if (sim.tick - op.job.createdAt > TIMEOUT) this.fail(id, sim)
  }

  // --- Operations ----------------------------------------------------------------------

  start(sim: FlowSim) {
    const rng = sim.rng
    const phase = this.phaseAt(sim.tick)
    const key = rng() < (phase?.hot ?? 0) ? HOT : 1 + Math.floor(rng() * (KEYS - 1))
    const kind = rng() < WRITE_SHARE ? 'write' : 'read'
    const job = sim.newJob(COORD_WORK, key, 'op')
    const cut = this.cfg.events.partition?.far ?? 0
    const far = this.partitioned(sim.tick) && rng() < cut
    this.ops.set(job.id, { job, kind, key, far, need: 0, got: [], acks: 0, waiting: 0, answered: [] })
    this.tally.sent++
    this.pass(job, 'clients', sim)
  }

  isRead(job: Job) {
    return this.ops.get(job.id)?.kind === 'read'
  }

  pass(job: Job, from: string, sim: FlowSim) {
    const next = this.front[this.front.indexOf(from) + 1]
    sim.forward(job, from, next ?? 'coord')
  }

  // The coordinator has an operation: find the nodes that hold its key and ask them.
  dispatch(job: Job, sim: FlowSim) {
    const op = this.ops.get(job.id)
    if (!op) return
    if (!this.cfg.ring || this.cfg.jam?.includes(this.cfg.ring)) return this.fail(job.id, sim)
    if (op.kind === 'write' && this.cfg.counter) return void this.later.push({ at: sim.tick + ROUND, job })
    this.go(job, sim)
  }

  private go(job: Job, sim: FlowSim) {
    const op = this.ops.get(job.id)
    if (!op) return
    const n = this.replicas()
    const holders = this.walk(op.key, n)
    const up = holders.filter((h) => this.reachable(h, op.far, sim.tick))
    const via = this.cfg.ring!
    if (op.kind === 'read') {
      const r = Math.min(this.cfg.readQ, n)
      if (up.length < r) return this.fail(job.id, sim)
      const picks = [...up].sort(() => sim.rng() - 0.5).slice(0, r)
      op.need = r
      for (const node of picks) this.send(op, node, 'read', via, sim)
      return
    }
    const w = Math.min(this.cfg.writeQ, n)
    const down = holders.filter((h) => !h.alive)
    const standIns = this.cfg.handoff
      ? this.walk(op.key, this.members().length)
          .filter((s) => !holders.includes(s) && this.reachable(s, op.far, sim.tick))
          .slice(0, down.length)
      : []
    if (up.length + standIns.length < w) return this.fail(job.id, sim)
    const live = this.members().filter((m) => this.reachable(m, op.far, sim.tick))
    const stamp = this.cfg.counter
      ? 1 + Math.max(0, ...up.map((u) => u.data.get(op.key)?.stamp ?? 0))
      : this.clock(live[Math.floor(sim.rng() * live.length)] ?? this.stores[0], sim.tick)
    const version = { stamp, id: job.id }
    op.need = w
    for (const node of up) this.send(op, node, 'write', via, sim, version)
    standIns.forEach((s, i) => this.send(op, s, 'hint', via, sim, version, down[i].key))
  }

  private clock(node: Storage, tick: number) {
    const s = this.cfg.events.skew
    return tick + (s && tick >= s.from && this.stores[Math.min(s.node, this.stores.length - 1)] === node ? SKEW : 0)
  }

  private send(op: Op, node: Storage, kind: Meta['kind'], via: string, sim: FlowSim, version?: Version, hintFor?: string) {
    const job = sim.newJob(kind === 'read' ? READ_WORK : WRITE_WORK, op.key, 'rw')
    job.via = node.key
    this.metas.set(job.id, { op: op.job.id, node: node.key, kind, version, hintFor })
    op.waiting++
    sim.forward(job, 'coord', via)
  }

  // A storage node finished a request.
  served(job: Job, node: Storage, sim: FlowSim) {
    const meta = this.metas.get(job.id)
    if (!meta) return
    this.metas.delete(job.id)
    const op = this.ops.get(meta.op)
    if (meta.kind === 'write') node.apply(job.key!, meta.version!)
    if (meta.kind === 'hint') this.hints.push({ node: meta.hintFor!, key: job.key!, version: meta.version! })
    if (!op) return
    op.waiting--
    if (meta.kind === 'read') {
      op.answered.push(node.key)
      const v = node.data.get(job.key!)
      if (v) op.got.push(v)
      if (op.answered.length < op.need) return
      const best = op.got.reduce<Version | undefined>((a, v) => (newer(v, a) ? v : a), undefined)
      if (this.cfg.repair && best) {
        for (const key of op.answered) this.stores.find((s) => s.key === key)?.apply(op.key, best)
      }
      return this.answered(op.job, best, sim)
    }
    if (++op.acks < op.need) return
    this.truth.set(op.key, { id: Math.max(op.job.id, this.truth.get(op.key)?.id ?? 0), at: sim.tick })
    this.finish(op.job, sim)
  }

  // A read has its answer: check it against what was written, then reply.
  answered(job: Job, version: Version | undefined, sim: FlowSim) {
    const op = this.ops.get(job.id)
    if (!op) return
    const t = this.truth.get(op.key)
    this.tally.reads++
    if (t && sim.tick - t.at > GRACE && (!version || version.id < t.id)) this.tally.stale++
    this.cache?.fill(op.key, version, sim.tick)
    this.finish(job, sim)
  }

  private finish(job: Job, sim: FlowSim) {
    if (!this.ops.delete(job.id)) return
    this.tally.done++
    sim.complete(job)
  }

  private fail(id: number, sim: FlowSim) {
    const op = this.ops.get(id)
    if (!op) return
    this.ops.delete(id)
    this.tally.failed++
    sim.drop(op.job, 'coord')
  }

  // Something was thrown away on its way.
  private lose(job: Job) {
    if (job.from === 'op') {
      if (this.ops.delete(job.id)) this.tally.failed++
    } else if (job.from === 'rw') {
      const meta = this.metas.get(job.id)
      if (!meta) return
      this.metas.delete(job.id)
      const op = this.ops.get(meta.op)
      if (!op) return
      op.waiting--
      const reachable = op.kind === 'read' ? op.answered.length + op.waiting : op.acks + op.waiting
      if (reachable < op.need) this.fail(meta.op, this.flow)
    }
  }

  // --- What the checks read -----------------------------------------------------

  wait() {
    return this.flow.avgLatency() / SECOND
  }

  failShare() {
    const total = this.tally.done + this.tally.failed
    return total === 0 ? 0 : this.tally.failed / total
  }

  // Copies, on nodes that are up, that do not hold the latest write of their key.
  diverged() {
    let n = 0
    for (const [key, t] of this.truth) {
      for (const node of this.walk(key, this.replicas())) {
        if (!node.alive) continue
        const v = node.data.get(key)
        if (!v || v.id < t.id) n++
      }
    }
    return n
  }

  nodeLoad(key: string) {
    const s = this.stores.find((x) => x.key === key)
    return s ? s.load() / NODE_LINE : 0
  }

  streaming(tick: number) {
    const j = this.cfg.events.join
    return !!j && tick >= j.at && tick < j.at + STREAM
  }

  joined(tick: number) {
    const j = this.cfg.events.join
    return !j || tick >= j.at
  }

  isPartitioned(tick: number) {
    return this.partitioned(tick)
  }

  farKeys() {
    return this.far().map((s) => s.key)
  }
}
