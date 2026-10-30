import { FlowSim, type FlowNode, type Job } from '../../core/flow/engine'
import { SECOND, TICKS_PER_SECOND } from '../../core/flow/time'
import { Limiter, Net, Pool } from '../../core/flow/parts'

// A chat app, as a running system. A message travels
//   sender → (limiter) → gateway → chat service → store, and once it is stored
//   chat service → (pub/sub topic) → the recipient's gateway → recipient.
// Phones keep one open connection to a gateway, and a gateway only holds so many.
// Recipients may be away (a message waits in an inbox queue), the network may lose
// an ack (the sender sends again), and a gateway may crash (its phones all reconnect).
// Every piece is optional, so a bad design shows how it fails.

export { SECOND, TICKS_PER_SECOND }

export type Kind = 'dm' | 'group' | 'big'
// Recipients of one message of each kind. A real big group has far more; this stands for them.
export const MEMBERS: Record<Kind, number> = { dm: 1, group: 8, big: 3000 }
export const CONN_CAP = 1000 // phones one gateway holds open
const ACCEPT = 300 // phones one gateway lets in a second
const RETRIES = 3 // times a second a phone tries again when it retries at once
const AWAY = 0.25 // share of recipients who are away
const BACK = 4 * SECOND // how long they stay away
const ACK_LOSS = 0.1 // share of first acks the network loses
const RETRY_WAIT = SECOND
const TRIES = 3
const SWAP = 0.2 // chance a message overtakes the one before it, when nothing numbers them
const GATE_SLOTS = 8
const GATE_LINE = 30
const CHAT_TAKE = 8
const CHAT_LINE = 40
const SEND = 6 // writes the chat service sends the store per tick
const STORE_SLOTS = 6
const STORE_LINE = 40
const WRITE_ROOM = 30 // the chat service only sends a write while the store has fewer than this waiting
const INBOX_CAPACITY = 400
const LIMIT_RATE = 12 // messages a second one rate limiter lets through
const RECENT = 10 * SECOND
const LINK = 4 // ticks a message takes to cross a link
const RECHECK = 4 // ticks a phone without a connection waits before it looks again

export interface Phase {
  from: number // tick
  phones: number // phones with the app open
  dms: number // messages a second between two people
  groups?: number // messages a second to a small group
}

export interface Config {
  gateways: string[] // keys; the first is the one that may crash
  topic?: string
  inbox?: string
  dedupe?: string
  limits: string[]
  numbered: boolean // each chat numbers its messages
  shared: boolean // a group message is stored once, not once per member
  backoff: boolean // a phone that lost its gateway waits a growing time before it retries
  away: boolean // some recipients are away
  flaky: boolean // the network loses some acks
  phases: Phase[]
  bigs: number[] // ticks when someone writes to a huge group
  crash?: { at: number; down: number }
}

export interface Tally {
  sent: number // messages the sender got an ack for
  lost: number // messages the sender gave up on
  missed: number // messages that did not reach every recipient
  duplicates: number // messages shown twice
  misordered: number // messages that arrived before the one sent earlier
  delivered: number
  limited: number // messages a rate limiter turned away
}

const blank = (): Tally => ({ sent: 0, lost: 0, missed: 0, duplicates: 0, misordered: 0, delivered: 0, limited: 0 })

interface Msg {
  id: number
  kind: Kind
  at: number
  tries: number
  retryAt: number
  acked: boolean
  closed: boolean
  seen: boolean // the dedupe store has the id
  stored: number // times the whole message was written
  left: number // writes still to be acknowledged
  gw?: string // the gateway the sender used
  away: number
  pending: number // deliveries and inbox hand-ins on their way
  missed: number
  counted: boolean
}

// The phones: they send, and send again when no ack comes.
class Senders implements FlowNode {
  alive = true
  readonly key = 'senders'
  private chat: Chat
  private due = 0
  private dueGroups = 0
  constructor(chat: Chat) {
    this.chat = chat
  }
  receive() {}
  emit(sim: FlowSim) {
    const c = this.chat
    c.phones(sim)
    const phase = [...c.cfg.phases].reverse().find((p) => p.from <= sim.tick)
    if (phase) {
      this.due += phase.dms / SECOND
      this.dueGroups += (phase.groups ?? 0) / SECOND
    }
    for (; this.due >= 1; this.due--) c.write(sim, 'dm')
    for (; this.dueGroups >= 1; this.dueGroups--) c.write(sim, 'group')
    if (c.cfg.bigs.includes(sim.tick)) c.write(sim, 'big')
    c.retry(sim)
  }
}

// Where a delivery ends: the recipients' phones.
class Receivers implements FlowNode {
  alive = true
  readonly key = 'receivers'
  private chat: Chat
  constructor(chat: Chat) {
    this.chat = chat
  }
  receive(job: Job, sim: FlowSim) {
    sim.complete(job)
    this.chat.reached(job, sim)
  }
}

// Hands a message on to the gateway the recipient is connected to.
class Topic implements FlowNode {
  alive = true
  readonly key: string
  constructor(key: string) {
    this.key = key
  }
  receive(job: Job, sim: FlowSim) {
    sim.forward(job, this.key, job.via!)
  }
}

// Remembers the id of every message it has seen.
class Dedupe implements FlowNode {
  alive = true
  readonly key: string
  constructor(key: string) {
    this.key = key
  }
  receive(job: Job, sim: FlowSim) {
    sim.complete(job)
  }
}

// Holds messages for people who are away, until they are back.
class Inbox implements FlowNode {
  alive = true
  held: { entries: number; due: number }[] = []
  readonly key: string
  private chat: Chat
  constructor(key: string, chat: Chat) {
    this.key = key
    this.chat = chat
  }
  receive(job: Job, sim: FlowSim) {
    if (this.load() + job.key! > INBOX_CAPACITY) return sim.drop(job, this.key)
    this.held.push({ entries: job.key!, due: sim.tick + BACK })
    sim.complete(job)
    this.chat.handed(job)
  }
  process(sim: FlowSim) {
    this.held = this.held.filter((h) => h.due > sim.tick)
  }
  load() {
    return this.held.reduce((n, h) => n + h.entries, 0)
  }
}

// The chat service: takes a message, writes it to the store, then sends it on.
class Service implements FlowNode {
  alive = true
  readonly key = 'chat'
  inbox: Job[] = []
  todo: { m: Msg; left: number }[] = []
  private chat: Chat
  constructor(chat: Chat) {
    this.chat = chat
  }
  receive(job: Job, sim: FlowSim) {
    if (this.inbox.length >= CHAT_LINE) return sim.drop(job, this.key)
    this.inbox.push(job)
  }
  process(sim: FlowSim) {
    for (const job of this.inbox.splice(0, CHAT_TAKE)) this.chat.take(job, this, sim)
    let budget = SEND
    const store = this.chat.store
    // Writes a busy store turned away are sent again before anything new.
    while (budget > 0 && this.chat.resend.length) {
      if (store.load() >= WRITE_ROOM) break
      const write = sim.newJob(1, undefined, 'write')
      write.msg = this.chat.resend.shift()
      sim.forward(write, this.key, 's0')
      budget--
    }
    while (budget > 0 && this.todo.length) {
      const cur = this.todo[0]
      if (store.load() >= WRITE_ROOM) break
      const write = sim.newJob(1, undefined, 'write')
      write.msg = cur.m.id
      sim.forward(write, this.key, 's0')
      budget--
      if (--cur.left === 0) this.todo.shift()
    }
  }
  load() {
    return this.inbox.length + this.todo.reduce((n, t) => n + t.left, 0)
  }
}

export class Chat {
  readonly flow: Net
  readonly cfg: Config
  readonly tally = blank()
  readonly resend: number[] = [] // writes the store turned away
  readonly gates: Pool[] = []
  readonly store: Pool
  readonly service = new Service(this)
  readonly inbox?: Inbox
  connected = 0 // phones holding a connection
  waiting = 0 // phones with none
  crashAt = -1
  recoveredAt = -1
  private msgs = new Map<number, Msg>()
  private open: Msg[] = [] // sent, not acked yet
  private delays: { at: number; delay: number }[] = []
  private round = 0
  private nextId = 0
  private wait = 0 // ticks the crowd has been mostly waiting
  longestWait = 0

  constructor(rng: () => number, cfg: Config) {
    this.cfg = cfg
    const flow = (this.flow = new Net(rng))
    flow.onLoss = (job) => this.lose(job)
    flow.traffic = () => {
      const phase = [...cfg.phases].reverse().find((p) => p.from <= flow.tick)
      return phase ? phase.dms + (phase.groups ?? 0) : 0
    }
    flow.add(new Senders(this))
    flow.add(new Receivers(this))
    for (const key of cfg.limits) flow.add(new Limiter(key, LIMIT_RATE, () => this.tally.limited++, (job, sim) => this.pass(job, key, sim)))
    for (const key of cfg.gateways) {
      const gate = flow.add(new Pool(key, GATE_SLOTS, GATE_LINE, (job, sim) => this.passed(job, key, sim)))
      gate.refuse = () => this.storming()
      this.gates.push(gate)
      flow.link('senders', key, LINK)
      flow.link(key, 'chat', LINK)
      flow.link(key, 'receivers', LINK)
      for (const limit of cfg.limits) flow.link(limit, key, LINK)
    }
    for (const limit of cfg.limits) flow.link('senders', limit, LINK)
    flow.add(this.service)
    this.store = flow.add(new Pool('s0', STORE_SLOTS, STORE_LINE, (job, sim) => this.written(job, sim)))
    flow.link('chat', 's0', LINK)
    if (cfg.topic) {
      flow.add(new Topic(cfg.topic))
      flow.link('chat', cfg.topic, LINK)
      for (const key of cfg.gateways) flow.link(cfg.topic, key, LINK)
    } else for (const key of cfg.gateways) flow.link('chat', key, LINK)
    if (cfg.dedupe) {
      flow.add(new Dedupe(cfg.dedupe))
      flow.link('chat', cfg.dedupe, LINK)
    }
    if (cfg.inbox) {
      this.inbox = flow.add(new Inbox(cfg.inbox, this))
      flow.link('chat', cfg.inbox, LINK)
    }
    const first = cfg.phases[0]
    this.connected = Math.min(first?.phones ?? 0, cfg.gateways.length * CONN_CAP)
    this.waiting = Math.max(0, (first?.phones ?? 0) - this.connected)
  }

  // --- Phones and their connections ----------------------------------------------

  alive() {
    return this.gates.filter((g) => g.alive)
  }

  phonesNow(tick: number) {
    return [...this.cfg.phases].reverse().find((p) => p.from <= tick)?.phones ?? 0
  }

  // Phones that reconnect at once after a crash keep a gateway too busy to do anything else.
  storming() {
    return this.crashAt >= 0 && this.recoveredAt < 0 && !this.cfg.backoff && this.waiting > 0.5
  }

  phones(sim: FlowSim) {
    const dt = 1 / SECOND
    const { crash, backoff } = this.cfg
    if (crash && sim.tick === crash.at) {
      const gate = this.gates[0]
      const lost = this.connected / Math.max(1, this.alive().length)
      gate.alive = false
      sim.fail(gate.key)
      this.connected -= lost
      this.waiting += lost
      this.crashAt = sim.tick
      this.recoveredAt = -1
    }
    if (crash && sim.tick === crash.at + crash.down) this.gates[0].alive = true

    const phones = this.phonesNow(sim.tick)
    const have = this.connected + this.waiting
    if (phones > have) this.waiting += phones - have
    else if (phones < have) {
      const cut = have - phones
      const fromWaiting = Math.min(cut, this.waiting)
      this.waiting -= fromWaiting
      this.connected = Math.max(0, this.connected - (cut - fromWaiting))
    }

    const gates = this.alive().length
    const cap = gates * CONN_CAP
    if (this.waiting > 0 && gates > 0) {
      const accept = gates * ACCEPT
      const attempts = this.waiting * RETRIES
      const storm = this.crashAt >= 0 && this.recoveredAt < 0 && !backoff
      const rate = storm && attempts > accept ? accept * (accept / attempts) ** 2 : accept
      const free = Math.max(0, cap - this.connected)
      let letIn = Math.min(this.waiting, free, rate * dt)
      if (this.waiting - letIn < 0.5 && free >= this.waiting) letIn = this.waiting
      this.waiting -= letIn
      this.connected += letIn
    }
    // A gateway went away and the rest are full: the extra connections are shed.
    if (this.connected > cap) {
      this.waiting += this.connected - cap
      this.connected = cap
    }
    if (this.crashAt >= 0 && this.recoveredAt < 0 && this.waiting < 0.5 && gates > 0) this.recoveredAt = sim.tick

    this.wait = this.waiting > 0.05 * phones ? this.wait + 1 : 0
    this.longestWait = Math.max(this.longestWait, this.wait / SECOND)
  }

  // --- Sending ---------------------------------------------------------------------

  write(sim: FlowSim, kind: Kind) {
    const m: Msg = { id: this.nextId++, kind, at: sim.tick, tries: 0, retryAt: 0, acked: false, closed: false, seen: false, stored: 0, left: 0, away: 0, pending: 0, missed: 0, counted: false }
    this.msgs.set(m.id, m)
    this.open.push(m)
    this.send(m, sim)
  }

  private send(m: Msg, sim: FlowSim) {
    const phones = this.connected + this.waiting
    // A phone without a connection keeps the message until it has one.
    if (phones > 0 && sim.rng() < this.waiting / phones) {
      m.retryAt = sim.tick + RECHECK
      return
    }
    m.tries++
    m.retryAt = sim.tick + RETRY_WAIT
    const job = sim.newJob(1, undefined, 'msg')
    job.msg = m.id
    this.pass(job, 'senders', sim)
  }

  // Send again what has not been acked, and give up after a few tries.
  retry(sim: FlowSim) {
    this.open = this.open.filter((m) => !m.acked && !m.closed)
    for (const m of this.open) {
      if (m.retryAt > sim.tick) continue
      if (m.tries >= TRIES) {
        m.closed = true
        this.tally.lost++
      } else this.send(m, sim)
    }
  }

  // The next stop after `from`: a rate limiter, then a gateway.
  pass(job: Job, from: string, sim: FlowSim) {
    const limits = this.cfg.limits
    const next = limits[limits.indexOf(from) + 1]
    if (next && from !== 'senders') return sim.forward(job, from, next)
    if (from === 'senders' && limits.length) return sim.forward(job, from, limits[0])
    const alive = this.alive()
    if (!alive.length) return sim.drop(job, from)
    const gate = alive[this.round++ % alive.length]
    const m = this.msgs.get(job.msg!)
    if (m) m.gw = gate.key
    sim.forward(job, from, gate.key)
  }

  // A gateway finished with a request.
  private passed(job: Job, gate: string, sim: FlowSim) {
    if (job.from === 'deliver') sim.forward(job, gate, 'receivers')
    else sim.forward(job, gate, 'chat')
  }

  // --- The chat service ----------------------------------------------------------

  take(job: Job, svc: Service, sim: FlowSim) {
    const m = this.msgs.get(job.msg!)
    if (!m) return
    if (this.cfg.dedupe) {
      sim.forward(sim.newJob(1, undefined, 'check'), 'chat', this.cfg.dedupe)
      if (m.seen) return this.ack(m, sim)
      m.seen = true
    }
    const left = this.copies(m)
    m.left += left
    svc.todo.push({ m, left })
  }

  // Writes one message needs.
  copies(m: Msg) {
    return this.cfg.shared ? 1 : MEMBERS[m.kind]
  }

  // The store finished a write.
  private written(job: Job, sim: FlowSim) {
    const m = this.msgs.get(job.msg!)
    if (!m || --m.left > 0) return
    this.ack(m, sim)
    const again = m.stored++ > 0
    if (again) this.tally.duplicates++
    this.deliver(m, again, sim)
  }

  private ack(m: Msg, sim: FlowSim) {
    if (m.acked) return
    if (this.cfg.flaky && m.tries === 1 && sim.rng() < ACK_LOSS) return
    m.acked = true
    this.tally.sent++
  }

  // --- Delivering --------------------------------------------------------------------

  private deliver(m: Msg, again: boolean, sim: FlowSim) {
    const alive = this.alive()
    if (!alive.length) return
    const { topic, inbox, away: someAway } = this.cfg
    const n = MEMBERS[m.kind]
    const away = someAway ? (m.kind === 'dm' ? (sim.rng() < AWAY ? 1 : 0) : Math.round(n * AWAY)) : 0
    const online = n - away
    const local = alive.find((g) => g.key === m.gw) ?? alive[0]
    // The recipient of a message between two people is on one gateway; a group is spread over all of them.
    const shares = alive.map((g) => ({ g, share: m.kind === 'dm' ? 0 : online / alive.length }))
    if (m.kind === 'dm' && online > 0) shares[Math.floor(sim.rng() * alive.length)].share = 1
    for (const { g, share } of shares) {
      if (share <= 0) continue
      if (g !== local && !topic) {
        if (!again) m.missed += share
        continue
      }
      const job = sim.newJob(1, share, 'deliver')
      job.msg = m.id
      job.via = g.key
      job.attempts = again ? 1 : 0
      if (!again) m.pending++
      sim.forward(job, 'chat', topic ?? g.key)
    }
    if (away > 0) {
      m.away = away
      if (!inbox) {
        if (!again) m.missed += away
      } else {
        const job = sim.newJob(1, this.cfg.shared ? 1 : away, 'park')
        job.msg = m.id
        job.attempts = again ? 1 : 0
        if (!again) m.pending++
        sim.forward(job, 'chat', inbox)
      }
    }
    if (!again && m.pending === 0) this.settle(m)
  }

  // A delivery reached the recipients' phones.
  reached(job: Job, sim: FlowSim) {
    const m = this.msgs.get(job.msg!)
    if (!m || job.attempts) return
    this.delays.push({ at: sim.tick, delay: sim.tick - m.at })
    this.arrived(m)
  }

  // A message was handed to the inbox.
  handed(job: Job) {
    const m = this.msgs.get(job.msg!)
    if (m && !job.attempts) this.arrived(m)
  }

  private arrived(m: Msg) {
    m.pending--
    if (m.pending === 0) this.settle(m)
  }

  // Everything that could reach the recipients has: count how it went.
  private settle(m: Msg) {
    if (m.counted) return
    m.counted = true
    this.tally.delivered++
    if (m.missed > 0) this.tally.missed++
    if (this.alive().length > 1 && !this.cfg.numbered && this.flow.rng() < SWAP) this.tally.misordered++
  }

  // Something was thrown away on its way.
  private lose(job: Job) {
    if (job.from === 'write') {
      if (this.msgs.has(job.msg!)) this.resend.push(job.msg!)
      return
    }
    const m = this.msgs.get(job.msg!)
    if (!m || (job.from !== 'deliver' && job.from !== 'park') || job.attempts) return
    // A phone that lost its gateway fetches what it missed from its inbox once it is back.
    if (job.from === 'park' || !this.cfg.inbox) m.missed += job.from === 'deliver' ? job.key! : m.away
    this.arrived(m)
  }

  // --- What the checks read -----------------------------------------------------

  // Seconds the slowest message of the last 10 seconds took to reach a phone.
  slowest() {
    const t = this.flow.tick
    return Math.max(0, ...this.delays.filter((d) => t - d.at < RECENT).map((d) => d.delay)) / SECOND
  }

  // Writes and messages waiting to be stored.
  backlog() {
    return this.service.load()
  }

  // Share of the store's slots that are taken, 0 to 1.
  storeLoad() {
    return this.store.load() / STORE_LINE
  }
}
