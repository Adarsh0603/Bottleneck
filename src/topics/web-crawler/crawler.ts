import { FlowSim, type FlowNode, type Job } from '../../core/flow/engine'
import { Worker } from '../../core/flow/nodes'
import { SECOND, TICKS_PER_SECOND } from '../../core/flow/time'

// The web crawler, as a running system. URLs are the requests:
//   seeds → seen-set ("have I met this one?") → frontier (the to-do list)
//         → hash ring (one site, one fetcher) → fetchers → page store.
// Every page a fetcher downloads lists links; each link goes back to the seen-set.
// The pieces are all optional, so a bad design shows how it fails.

export { SECOND, TICKS_PER_SECOND }
const FETCH_WORK = 30 // a page takes a second and a half to download
const ROBOTS_WORK = 8 // reading a site's robots.txt the first time
const SLOTS = 4
const LOCAL_LINE = 10
const ROOM = SLOTS + 3 // what a fetcher may be given at once: working plus waiting
const FRONTIER_CAPACITY = 50
const SCAN = 40 // how far down the frontier it looks for a job a fetcher can take
const GAP = 10 // a site wants this long between two visits
const BAN_AFTER = 3 // visits that came too soon before a site bans the crawler
const LEASE = 40 // how long a handed-out URL may sit with a dead fetcher
const HASHES = 3
const VNODES = 24
const TRAP_BASE = 1_000_000

export const BITS = [2, 4, 8, 12, 16] // bits of seen-set per page on the web
export const BUDGETS = [20, 40, 50, 80, Infinity] // pages one site may put on the frontier
export const DELAYS = [0, 5, 10, 20, 40] // ticks a fetcher waits between visits to one site

const mix = (a: number, b: number) => {
  let x = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263)) | 0
  x = Math.imul(x ^ (x >>> 13), 1274126177)
  return (x ^ (x >>> 16)) >>> 0
}
const SPREAD = 2654435 // where a fetcher's points fall on the ring
const SALT = 3544 // where a site falls on it

// --- The web -----------------------------------------------------------------

export interface WebSpec {
  sizes: number[] // pages on each site
  trapHost?: number // the site with endless pages (it also has sizes[trapHost] real ones)
  privateHost: number // the site whose last pages robots.txt forbids
  privateCount: number
  lateSeed?: number // a first page of the trap site is found at this tick
}

export class Web {
  readonly spec: WebSpec
  readonly starts: number[]
  readonly real: number // real pages in all
  private readonly tame: number // real pages outside the trap site
  readonly wanted: Set<number>

  constructor(spec: WebSpec) {
    this.spec = spec
    this.starts = spec.sizes.map((_, h) => spec.sizes.slice(0, h).reduce((a, b) => a + b, 0))
    this.real = spec.sizes.reduce((a, b) => a + b, 0)
    this.tame = spec.trapHost === undefined ? this.real : this.starts[spec.trapHost]
    // What a polite crawler can reach: from the seeds, never through a forbidden page.
    this.wanted = new Set()
    const todo = [...this.seeds(), ...(spec.trapHost !== undefined && spec.lateSeed !== undefined ? [this.trapEntry()] : [])]
    while (todo.length) {
      const u = todo.pop()!
      if (this.wanted.has(u) || this.isTrap(u) || this.isPrivate(u)) continue
      this.wanted.add(u)
      todo.push(...this.links(u))
    }
  }

  isTrap(u: number) {
    return u >= TRAP_BASE
  }

  hostOf(u: number) {
    if (this.isTrap(u)) return this.spec.trapHost!
    let h = this.starts.length - 1
    while (this.starts[h] > u) h--
    return h
  }

  isPrivate(u: number) {
    if (this.isTrap(u)) return false
    const h = this.hostOf(u)
    return h === this.spec.privateHost && u >= this.starts[h] + this.spec.sizes[h] - this.spec.privateCount
  }

  // The first page of every ordinary site: where the crawl starts.
  seeds() {
    return this.starts.filter((_, h) => h !== this.spec.trapHost)
  }

  trapEntry() {
    return this.starts[this.spec.trapHost!]
  }

  // The links on a page. They wrap and cross sites, so the web has loops.
  links(u: number): number[] {
    if (this.isTrap(u)) {
      const t = u - TRAP_BASE
      return [TRAP_BASE + 3 * t, TRAP_BASE + 3 * t + 1, TRAP_BASE + 3 * t + 2]
    }
    const n = this.tame
    const h = this.hostOf(u)
    if (h === this.spec.trapHost) {
      // The front page lists the site's real pages first, then the way into the endless part.
      const rest = Array.from({ length: this.spec.sizes[h] - 1 }, (_, i) => this.starts[h] + 1 + i)
      return u === this.starts[h] ? [...rest, TRAP_BASE + 1] : []
    }
    return [(u + 1) % n, (u * 7 + 3) % n, (u * 5 + 11) % n]
  }
}

// --- Counting ----------------------------------------------------------------

export interface Tally {
  repeatsBlocked: number // links the seen-set stopped because the page was already known
  falseSkips: number // links it stopped although the page was new
  overBudget: number // links a site was not allowed to add any more of
  robotsSkipped: number // forbidden pages the fetcher left alone
  robotsBreaks: number // forbidden pages it read anyway
  tooFast: number // visits that came sooner than the site allows
  refused: number // visits to a site that had banned the crawler
  refetch: number // pages downloaded a second time
  trapFetched: number // pages of the endless site
}

const blank = (): Tally => ({ repeatsBlocked: 0, falseSkips: 0, overBudget: 0, robotsSkipped: 0, robotsBreaks: 0, tooFast: 0, refused: 0, refetch: 0, trapFetched: 0 })

// Remembers every URL that was thrown away on its way, to tell which were never fetched at all.
class Net extends FlowSim {
  lostUrls = new Set<number>()
  drop(job: Job, node: string) {
    super.drop(job, node)
    if (job.key !== undefined) this.lostUrls.add(job.key)
  }
}

// --- The pieces --------------------------------------------------------------

// Where the crawl begins, and one more page that turns up later.
class Seeds implements FlowNode {
  alive = true
  readonly key = 'seeds'
  private due: { u: number; at: number }[]
  private crawler: Crawler
  constructor(crawler: Crawler, urls: number[], late?: { u: number; at: number }) {
    this.crawler = crawler
    this.due = urls.map((u, i) => ({ u, at: 1 + i * 4 }))
    if (late) this.due.push(late)
  }
  receive() {}
  emit(sim: FlowSim) {
    while (this.due.length && this.due[0].at <= sim.tick) {
      const { u } = this.due.shift()!
      this.crawler.submit(sim.newJob(0, u, 'seeds'), this.key, sim)
    }
  }
}

// A Bloom filter: a row of switches. Each URL flips three of them. A URL whose three
// are all on is "seen", which may be wrong, but a URL that was added is never "new".
class Seen implements FlowNode {
  alive = true
  readonly key: string
  readonly bits: Uint8Array
  private on = 0
  private added = new Set<number>()
  private crawler: Crawler
  constructor(key: string, size: number, crawler: Crawler) {
    this.key = key
    this.bits = new Uint8Array(size)
    this.crawler = crawler
  }

  private spots(u: number) {
    return Array.from({ length: HASHES }, (_, i) => mix(u, i + 1) % this.bits.length)
  }

  receive(job: Job, sim: FlowSim) {
    const u = job.key!
    const spots = this.spots(u)
    if (spots.every((i) => this.bits[i])) {
      if (this.added.has(u)) this.crawler.tally.repeatsBlocked++
      else {
        this.crawler.tally.falseSkips++
        this.crawler.skipped.add(u)
      }
      return
    }
    for (const i of spots) {
      if (!this.bits[i]) this.on++
      this.bits[i] = 1
    }
    this.added.add(u)
    this.crawler.submit(job, this.key, sim)
  }

  // Share of switches that are on, 0 to 1.
  fill() {
    return this.on / this.bits.length
  }
}

// The to-do list. It hands each URL to a fetcher with room for it.
class Frontier implements FlowNode {
  alive = true
  jobs: Job[] = []
  readonly capacity = FRONTIER_CAPACITY
  readonly key: string
  private perSite = new Map<number, number>()
  private out = new Map<number, { job: Job; to: string; at: number }>()
  private crawler: Crawler
  constructor(key: string, crawler: Crawler) {
    this.key = key
    this.crawler = crawler
  }

  receive(job: Job, sim: FlowSim) {
    const c = this.crawler
    const h = c.web.hostOf(job.key!)
    const used = this.perSite.get(h) ?? 0
    if (used >= c.cfg.budget) {
      c.tally.overBudget++
      return
    }
    if (this.jobs.length >= this.capacity) return sim.drop(job, this.key)
    this.perSite.set(h, used + 1)
    this.jobs.push(job)
  }

  ack(job: Job) {
    this.out.delete(job.id)
  }

  // URLs the list still has, or will take back from a dead fetcher.
  holding() {
    return new Set([...this.jobs, ...[...this.out.values()].map((o) => o.job)].map((j) => j.key!))
  }

  process(sim: FlowSim) {
    const c = this.crawler
    // A URL handed to a fetcher that died goes back on the list, if the list kept track of it.
    for (const [id, o] of this.out) {
      const node = sim.node(o.to)
      if (node && !node.alive && sim.tick - o.at > LEASE) {
        this.out.delete(id)
        this.jobs.unshift(o.job)
      }
    }
    let seen = 0
    for (let i = 0; i < this.jobs.length && seen < SCAN; seen++) {
      const job = this.jobs[i]
      const to = c.candidates(job.key!).find((f) => sim.pending(f) < ROOM)
      if (!to) {
        i++
        continue
      }
      this.jobs.splice(i, 1)
      if (c.cfg.keep) this.out.set(job.id, { job, to: to.key, at: sim.tick })
      c.rotate++
      sim.forward(job, this.key, c.after(this.key) ?? to.key)
    }
  }

  load() {
    return this.jobs.length
  }
}

// Consistent hashing: every site belongs to one fetcher, and when a fetcher dies
// only its sites move.
class Ring implements FlowNode {
  alive = true
  readonly key: string
  private crawler: Crawler
  constructor(key: string, crawler: Crawler) {
    this.key = key
    this.crawler = crawler
  }
  receive(job: Job, sim: FlowSim) {
    const f = this.crawler.owner(job.key!)
    if (f) sim.forward(job, this.key, f.key)
    else sim.drop(job, this.key)
  }
}

// Downloads pages. It waits between two visits to one site, if the crawler is told to,
// but only knows about the visits it made itself.
class Fetcher extends Worker {
  private last = new Map<number, number>()
  private robotsRead = new Set<number>()
  private crawler: Crawler
  constructor(key: string, crawler: Crawler) {
    super(key, { slots: SLOTS, queueLimit: LOCAL_LINE })
    this.crawler = crawler
  }

  receive(job: Job, sim: FlowSim) {
    if (!this.alive || this.queue.length >= this.queueLimit) return sim.drop(job, this.key)
    this.queue.push(job)
  }

  process(sim: FlowSim) {
    const c = this.crawler
    for (let i = 0; i < this.queue.length && this.active.length < this.slots; ) {
      const job = this.queue[i]
      const u = job.key!
      const h = c.web.hostOf(u)
      if (c.cfg.robots && c.web.isPrivate(u)) {
        this.queue.splice(i, 1)
        c.tally.robotsSkipped++
        c.frontier?.ack(job)
        continue
      }
      const last = this.last.get(h)
      if (last !== undefined && sim.tick - last < c.cfg.delay) {
        i++
        continue
      }
      this.queue.splice(i, 1)
      this.last.set(h, sim.tick)
      job.remaining = FETCH_WORK + (c.cfg.robots && !this.robotsRead.has(h) ? ROBOTS_WORK : 0)
      this.robotsRead.add(h)
      c.visit(job, sim)
      this.active.push(job)
    }
    const working: Job[] = []
    for (const job of this.active) {
      job.remaining -= this.speed
      if (job.remaining > 0) {
        working.push(job)
        continue
      }
      this.served++
      c.finish(this.key, job, sim)
    }
    this.active = working
  }
}

// A part standing where URLs cannot get through: it turns everything away.
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

// Things that happen at a set time.
class Clock implements FlowNode {
  alive = true
  readonly key = 'clock'
  private crawler: Crawler
  constructor(crawler: Crawler) {
    this.crawler = crawler
  }
  receive() {}
  process(sim: FlowSim) {
    const { crashAt, crashKey } = this.crawler.cfg
    if (crashAt !== undefined && crashKey && sim.tick === crashAt) {
      sim.fail(crashKey)
      const node = sim.node(crashKey)
      if (node) node.alive = false
    }
  }
}

// --- The crawler -------------------------------------------------------------

export interface Config {
  web: Web
  apps: string[] // keys of the fetchers
  seen?: number // bits per page; absent = no seen-set
  frontier: boolean
  ring: boolean
  budget: number // pages one site may put on the frontier
  keep: boolean // the frontier keeps a URL until its fetcher says it is done
  delay: number // ticks a fetcher waits between visits to one site
  robots: boolean // read robots.txt and leave forbidden pages alone
  keys: { seen: string; frontier: string; ring: string }
  jam?: string[] // parts standing in the wrong order: they turn all URLs away
  crashAt?: number
  crashKey?: string
}

export class Crawler {
  readonly flow: Net
  readonly cfg: Config
  readonly web: Web
  readonly tally = blank()
  readonly fetched = new Set<number>()
  readonly skipped = new Set<number>() // new pages the seen-set wrongly turned away
  readonly banned = new Set<number>()
  readonly seen?: Seen
  readonly frontier?: Frontier
  readonly fetchers: Fetcher[] = []
  rotate = 0
  private started: number[] = [] // ticks of the visits begun in the last second
  private stages: string[] = []
  private violations = new Map<number, number>()
  private siteLast = new Map<number, number>()
  private refused = new Set<number>()
  private points = new Map<string, { p: number; f: Fetcher }[]>()

  constructor(rng: () => number, cfg: Config) {
    this.cfg = cfg
    this.web = cfg.web
    const flow = (this.flow = new Net(rng))
    flow.traffic = () => this.started.filter((t) => flow.tick - t < SECOND).length
    const { keys } = cfg
    const late = cfg.web.spec.lateSeed !== undefined ? { u: cfg.web.trapEntry(), at: cfg.web.spec.lateSeed } : undefined
    flow.add(new Seeds(this, cfg.web.seeds(), late))
    flow.add(new Clock(this))
    flow.add(new Worker('db', { slots: 8, queueLimit: 200, workPerRequest: 2 }))

    if (cfg.jam?.length) {
      for (const key of cfg.apps) flow.add(new Fetcher(key, this))
      for (const key of cfg.jam) {
        flow.add(new Jam(key))
        flow.link('seeds', key, 6)
      }
      return
    }

    if (cfg.seen) {
      this.seen = flow.add(new Seen(keys.seen, Math.round(cfg.seen * cfg.web.real), this))
      this.stages.push(keys.seen)
    }
    if (cfg.frontier) {
      this.frontier = flow.add(new Frontier(keys.frontier, this))
      this.stages.push(keys.frontier)
    }
    if (cfg.ring) {
      flow.add(new Ring(keys.ring, this))
      this.stages.push(keys.ring)
    }
    for (const key of cfg.apps) {
      const f = flow.add(new Fetcher(key, this))
      this.fetchers.push(f)
      flow.link(key, 'db', 8)
    }
    // The route a URL takes: each stage to the next, the last one to the fetchers.
    const chain = ['seeds', ...this.stages]
    chain.forEach((from, i) => {
      const next = chain[i + 1]
      if (next) flow.link(from, next, next === keys.ring ? 0 : 6)
      else for (const key of cfg.apps) flow.link(from, key, 6)
    })
  }

  // The stage after `from`, if there is one that is not the fetchers themselves.
  after(from: string): string | undefined {
    const i = this.stages.indexOf(from)
    return i >= 0 ? this.stages[i + 1] : undefined
  }

  // Send a URL on to whatever comes next.
  submit(job: Job, from: string, sim: FlowSim) {
    const i = this.stages.indexOf(from)
    const next = this.stages[i + 1]
    if (next) return sim.forward(job, from, next)
    const f = this.candidates(job.key!)[0]
    if (f) sim.forward(job, from, f.key)
    else sim.drop(job, from)
  }

  // Fetchers that could take this URL, best first.
  candidates(u: number): Fetcher[] {
    if (this.cfg.ring) {
      const f = this.owner(u)
      return f ? [f] : []
    }
    const alive = this.fetchers.filter((f) => f.alive)
    return alive.map((_, k) => alive[(k + this.rotate) % alive.length])
  }

  // The fetcher a site belongs to on the hash ring. A fetcher's place on the ring comes
  // from its number, so it keeps it when another one dies.
  owner(u: number): Fetcher | undefined {
    const alive = this.fetchers.filter((f) => f.alive)
    if (alive.length === 0) return undefined
    const id = alive.map((f) => f.key).join()
    let ring = this.points.get(id)
    if (!ring) {
      ring = alive.flatMap((f) => Array.from({ length: VNODES }, (_, i) => ({ p: mix(this.fetchers.indexOf(f) + 1, i * SPREAD + 1), f }))).sort((a, b) => a.p - b.p)
      this.points.set(id, ring)
    }
    const at = mix(this.web.hostOf(u), SALT)
    return (ring.find((x) => x.p >= at) ?? ring[0]).f
  }

  // The site's side of a visit: does it mind?
  visit(job: Job, sim: FlowSim) {
    this.started = this.started.filter((t) => sim.tick - t < SECOND)
    this.started.push(sim.tick)
    const u = job.key!
    const h = this.web.hostOf(u)
    if (!this.cfg.robots && this.web.isPrivate(u)) this.tally.robotsBreaks++
    if (this.banned.has(h)) {
      this.refused.add(job.id)
      return
    }
    const last = this.siteLast.get(h)
    if (last !== undefined && sim.tick - last < GAP) {
      this.tally.tooFast++
      const n = (this.violations.get(h) ?? 0) + 1
      this.violations.set(h, n)
      if (n >= BAN_AFTER) {
        this.banned.add(h)
        this.refused.add(job.id)
      }
    }
    this.siteLast.set(h, sim.tick)
  }

  // A fetcher has the page: save it, and send every link on it back to the seen-set.
  finish(fetcher: string, job: Job, sim: FlowSim) {
    this.frontier?.ack(job)
    const u = job.key!
    if (this.refused.delete(job.id)) {
      this.tally.refused++
      this.flow.lostUrls.add(u)
      return
    }
    if (this.fetched.has(u)) this.tally.refetch++
    else this.fetched.add(u)
    if (this.web.isTrap(u)) this.tally.trapFetched++
    sim.forward(job, fetcher, 'db')
    for (const v of this.web.links(u)) this.submit(sim.newJob(0, v, 'link'), fetcher, sim)
  }

  // --- What the checks read --------------------------------------------------

  get jammed() {
    return !!this.cfg.jam?.length
  }

  get wanted() {
    return this.web.wanted.size
  }

  // Pages a polite crawler should have, that it has.
  got() {
    let n = 0
    for (const u of this.web.wanted) if (this.fetched.has(u)) n++
    return n
  }

  // Pages that were thrown away on the way and never fetched at all.
  lost() {
    const held = this.frontier?.holding()
    let n = 0
    for (const u of this.flow.lostUrls) if (this.web.wanted.has(u) && !this.fetched.has(u) && !held?.has(u)) n++
    return n
  }

  missedByFilter() {
    let n = 0
    for (const u of this.skipped) if (this.web.wanted.has(u) && !this.fetched.has(u)) n++
    return n
  }
}
