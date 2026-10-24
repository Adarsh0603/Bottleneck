// Consensus, a small version of Raft:
//
//   Ana ─┐
//        ├─▶ servers in a ring, each keeping a ledger of seat bookings
//   Ben ─┘
//
// Each round, Ana and Ben both go for the same seat, at two different servers.
// What the servers do about it is the `rule`:
//   - anyone: every server confirms a booking on its own, then tells the others.
//     Two servers can sell the same seat.
//   - leader: one server (the leader) orders every booking and copies it out. A
//     booking counts once a majority of servers hold it. If the leader goes
//     quiet, followers time out, one stands for election, and a majority of
//     votes makes it the new leader.
//
// Customers are not servers: they can always reach any server that is up. The
// split only cuts servers off from each other.

import type { Client } from './world'
import { CLIENT_ID, CLIENTS, MAX_NODES, TICKS_PER_SECOND } from './world'
import type { ConsensusState, Rule } from './types'

export const LATENCY = 24 // ticks for a message to cross the floor, slow enough to follow by eye
const HEARTBEAT = 30
const RETRY = LATENCY * 12 // a customer with no answer asks again after this long
const RECENT = TICKS_PER_SECOND * 8
const ROUND_GAP = 2 // ticks between Ana's request and Ben's

export interface Entry {
  idx: number // 1-based place in the ledger
  term: number
  seat: number
  who: Client
  req: number
  clash?: boolean // another customer was also told this seat is theirs
}

export type Role = 'follower' | 'candidate' | 'leader'

export class Node {
  alive = true
  role: Role = 'follower'
  term = 0
  votedFor: number | null = null
  votes = new Set<number>()
  timer = 0 // ticks until this server gives up waiting for a leader
  hb = 0 // ticks until the leader's next heartbeat
  knownLeader: number | null = null
  log: Entry[] = []
  commit = 0
  next: number[] = []
  match: number[] = []
  readonly id: number
  constructor(id: number) {
    this.id = id
  }
}

interface Wire {
  id: number
  from: number
  to: number
  sentAt: number
  arrive: number
}

export type Body =
  | { kind: 'book'; req: number; seat: number; who: Client; hops: number }
  | { kind: 'copy'; entry: Entry }
  | { kind: 'append'; term: number; prevIdx: number; prevTerm: number; entries: Entry[]; commit: number }
  | { kind: 'appendReply'; term: number; ok: boolean; match: number }
  | { kind: 'vote'; term: number; lastIdx: number; lastTerm: number }
  | { kind: 'voteReply'; term: number; granted: boolean }
  | { kind: 'answer'; req: number; ok: boolean; seat: number; who: Client }

export type Msg = Wire & Body

interface Req {
  id: number
  who: Client
  seat: number
  lastSend: number
  done: null | 'ok' | 'no'
  doneAt: number
  target?: number // where a request that goes out a moment later is headed
}

export interface ConsensusMetrics {
  confirmed: number // bookings customers were told are theirs
  clashes: number // seats sold twice in the last few seconds
  clashTotal: number
  confirmedRecent: number // bookings confirmed in the last few seconds
  waiting: number // customers still waiting for an answer
  leader: number | null
  leaders: number // servers that think they lead, which should be one
  term: number
  stall: number // seconds with no leader
}

export class ConsensusSim {
  nodes: Node[] = Array.from({ length: MAX_NODES }, (_, i) => new Node(i))
  msgs: Msg[] = []
  tick = 0
  requests = new Map<number, Req>()
  confirmed = 0
  clashEvents: { tick: number; seat: number }[] = []
  confirmTicks: number[] = []
  stallTicks = 0

  private st: ConsensusState = { size: 3, pace: 0, manual: false, again: 0, rule: 'anyone', elections: false, down: [], split: 0, timeout: 3, spread: 0 }
  private rule: Rule | null = null
  private owners = new Map<number, Set<Client>>()
  private msgId = 0
  private reqId = 0
  private seatCounter = 0
  private roundIn = 10
  private later: { at: number; req: number }[] = []
  private again = 0
  private raceDue = false
  private downKey = ''

  private rng: () => number
  constructor(rng: () => number = Math.random) {
    this.rng = rng
  }

  get size() {
    return this.st.size
  }

  get active() {
    return this.nodes.slice(0, this.st.size)
  }

  private get majority() {
    return Math.floor(this.st.size / 2) + 1
  }

  private side(id: number) {
    return id >= this.st.size - this.st.split ? 1 : 0
  }

  reachable(a: number, b: number) {
    return a < 0 || b < 0 || this.side(a) === this.side(b)
  }

  apply(st: ConsensusState) {
    this.st = st
    if (st.again !== this.again) {
      this.again = st.again
      this.raceDue = st.manual && st.again > 0
    }
    // A change of rule or a crash is worth seeing play out on a fresh race.
    const downKey = st.down.join(',')
    if (st.manual && st.again > 0 && (st.rule !== this.rule || downKey !== this.downKey) && this.rule !== null) this.raceDue = true
    this.downKey = downKey
    for (const n of this.nodes) {
      const up = n.id < st.size && !st.down.includes(n.id)
      if (up && !n.alive) {
        // With no elections a restarted leader simply carries on leading.
        if (!(n.role === 'leader' && !st.elections)) n.role = 'follower'
        n.knownLeader = null
        n.votes.clear()
        this.resetTimer(n)
      }
      n.alive = up
    }
    if (st.rule !== this.rule) {
      this.rule = st.rule
      this.msgs = []
      this.requests.clear()
      this.later = []
      this.owners.clear()
      this.confirmed = 0
      this.clashEvents = []
      this.confirmTicks = []
      for (const n of this.nodes) {
        n.log = []
        n.commit = 0
        n.term = 0
        n.role = 'follower'
        n.votedFor = null
        n.knownLeader = null
        n.votes.clear()
      }
      if (st.rule === 'leader') this.installLeader()
    }
  }

  private installLeader() {
    const first = this.active.find((n) => n.alive)
    if (!first) return
    for (const n of this.active) {
      n.term = 1
      n.knownLeader = first.id
      this.resetTimer(n)
    }
    this.becomeLeader(first, false)
  }

  private resetTimer(n: Node) {
    n.timer = Math.round((this.st.timeout + this.rng() * this.st.spread) * TICKS_PER_SECOND)
  }

  private send(from: number, to: number, body: Body) {
    if (!this.reachable(from, to)) return
    this.msgs.push({ id: ++this.msgId, from, to, sentAt: this.tick, arrive: this.tick + LATENCY, ...body })
  }

  private answer(from: number, req: number, ok: boolean, seat: number, who: Client) {
    this.send(from, CLIENT_ID[who], { kind: 'answer', req, ok, seat, who })
  }

  private alive() {
    return this.active.filter((n) => n.alive)
  }

  // ---- customers ----

  private newRound() {
    const seat = ++this.seatCounter
    const [ana, ben] = CLIENTS.map((who) => {
      const r: Req = { id: ++this.reqId, who, seat, lastSend: this.tick, done: null, doneAt: 0 }
      this.requests.set(r.id, r)
      return r
    })
    const up = this.alive()
    if (up.length === 0) return
    const a = up[Math.floor(this.rng() * up.length)]
    const others = up.filter((n) => n !== a)
    const b = others.length ? others[Math.floor(this.rng() * others.length)] : a
    this.ask(ana, a.id)
    this.later.push({ at: this.tick + ROUND_GAP, req: ben.id })
    ben.target = b.id
  }

  private ask(r: Req, to: number) {
    r.lastSend = this.tick
    this.send(CLIENT_ID[r.who], to, { kind: 'book', req: r.id, seat: r.seat, who: r.who, hops: 0 })
  }

  private clientsStep() {
    const t = this.tick
    if (this.raceDue) {
      this.raceDue = false
      this.newRound()
    } else if (!this.st.manual && this.st.pace > 0 && --this.roundIn <= 0) {
      this.newRound()
      this.roundIn = Math.round(TICKS_PER_SECOND / this.st.pace)
    }
    for (const l of this.later.filter((x) => x.at <= t)) {
      const r = this.requests.get(l.req)
      if (r && !r.done) this.ask(r, r.target ?? 0)
    }
    this.later = this.later.filter((x) => x.at > t)
    for (const r of this.requests.values()) {
      if (r.done) {
        if (t - r.doneAt > TICKS_PER_SECOND * 2) this.requests.delete(r.id)
        continue
      }
      if (t - r.lastSend < RETRY) continue
      const up = this.alive()
      if (up.length) this.ask(r, up[Math.floor(this.rng() * up.length)].id)
    }
  }

  private onAnswer(m: Msg & { kind: 'answer' }) {
    const r = this.requests.get(m.req)
    if (!r || r.done) return
    r.done = m.ok ? 'ok' : 'no'
    r.doneAt = this.tick
    if (!m.ok) return
    this.confirmed++
    this.confirmTicks.push(this.tick)
    const owners = this.owners.get(m.seat) ?? new Set<Client>()
    owners.add(m.who)
    this.owners.set(m.seat, owners)
    if (owners.size > 1) this.clashEvents.push({ tick: this.tick, seat: m.seat })
  }

  // ---- servers ----

  private onBook(n: Node, m: Msg & { kind: 'book' }) {
    const known = n.log.find((e) => e.req === m.req)
    if (this.rule === 'anyone') {
      if (known) return this.answer(n.id, m.req, true, m.seat, m.who)
      if (n.log.some((e) => e.seat === m.seat)) return this.answer(n.id, m.req, false, m.seat, m.who)
      const entry: Entry = { idx: n.log.length + 1, term: 0, seat: m.seat, who: m.who, req: m.req }
      n.log.push(entry)
      n.commit = n.log.length
      this.answer(n.id, m.req, true, m.seat, m.who)
      for (const p of this.active) if (p !== n) this.send(n.id, p.id, { kind: 'copy', entry: { ...entry } })
      return
    }
    if (n.role === 'leader') {
      if (known) return known.idx <= n.commit ? this.answer(n.id, m.req, true, m.seat, m.who) : undefined
      if (n.log.some((e) => e.seat === m.seat)) return this.answer(n.id, m.req, false, m.seat, m.who)
      n.log.push({ idx: n.log.length + 1, term: n.term, seat: m.seat, who: m.who, req: m.req })
      this.replicate(n)
      return
    }
    // A follower passes the booking on to the leader it knows of.
    if (n.knownLeader !== null && n.knownLeader !== n.id && m.hops < 2) {
      this.send(n.id, n.knownLeader, { kind: 'book', req: m.req, seat: m.seat, who: m.who, hops: m.hops + 1 })
    }
  }

  private onCopy(n: Node, m: Msg & { kind: 'copy' }) {
    const have = n.log.find((e) => e.seat === m.entry.seat)
    if (!have) {
      n.log.push({ ...m.entry, idx: n.log.length + 1 })
      n.commit = n.log.length
    } else if (have.who !== m.entry.who) have.clash = true
  }

  private replicate(l: Node) {
    for (const p of this.active) if (p !== l) this.sendAppend(l, p)
  }

  private sendAppend(l: Node, p: Node) {
    const next = Math.min(Math.max(1, l.next[p.id] ?? 1), l.log.length + 1)
    const prevIdx = next - 1
    this.send(l.id, p.id, {
      kind: 'append',
      term: l.term,
      prevIdx,
      prevTerm: prevIdx > 0 ? l.log[prevIdx - 1].term : 0,
      entries: l.log.slice(prevIdx).map((e) => ({ ...e })),
      commit: l.commit,
    })
  }

  private stepDown(n: Node, term: number) {
    n.term = term
    n.votedFor = null
    n.votes.clear()
    if (n.role !== 'follower') this.resetTimer(n)
    n.role = 'follower'
  }

  private onAppend(n: Node, m: Msg & { kind: 'append' }) {
    if (m.term < n.term) return this.send(n.id, m.from, { kind: 'appendReply', term: n.term, ok: false, match: 0 })
    if (m.term > n.term) this.stepDown(n, m.term)
    n.role = 'follower'
    n.knownLeader = m.from
    this.resetTimer(n)
    if (m.prevIdx > n.log.length || (m.prevIdx > 0 && n.log[m.prevIdx - 1].term !== m.prevTerm)) {
      return this.send(n.id, m.from, { kind: 'appendReply', term: n.term, ok: false, match: 0 })
    }
    for (const e of m.entries) {
      const mine = n.log[e.idx - 1]
      if (mine && mine.term !== e.term) n.log.length = e.idx - 1
      if (n.log.length === e.idx - 1) n.log.push({ ...e })
    }
    const last = m.prevIdx + m.entries.length
    if (m.commit > n.commit) n.commit = Math.min(m.commit, last)
    this.send(n.id, m.from, { kind: 'appendReply', term: n.term, ok: true, match: last })
  }

  private onAppendReply(l: Node, m: Msg & { kind: 'appendReply' }) {
    if (m.term > l.term) return this.stepDown(l, m.term)
    if (l.role !== 'leader' || m.term < l.term) return
    const p = this.nodes[m.from]
    if (m.ok) {
      l.match[p.id] = Math.max(l.match[p.id] ?? 0, m.match)
      l.next[p.id] = l.match[p.id] + 1
      this.advanceCommit(l)
    } else {
      l.next[p.id] = Math.max(1, (l.next[p.id] ?? 1) - 1)
      this.sendAppend(l, p)
    }
  }

  private advanceCommit(l: Node) {
    for (let n = l.log.length; n > l.commit; n--) {
      if (l.log[n - 1].term !== l.term) break
      const have = 1 + this.active.filter((p) => p !== l && (l.match[p.id] ?? 0) >= n).length
      if (have < this.majority) continue
      for (let i = l.commit + 1; i <= n; i++) {
        const e = l.log[i - 1]
        this.answer(l.id, e.req, true, e.seat, e.who)
      }
      l.commit = n
      return
    }
  }

  private startElection(n: Node) {
    n.term++
    n.role = 'candidate'
    n.votedFor = n.id
    n.votes = new Set([n.id])
    n.knownLeader = null
    this.resetTimer(n)
    const lastIdx = n.log.length
    const lastTerm = lastIdx ? n.log[lastIdx - 1].term : 0
    for (const p of this.active) if (p !== n) this.send(n.id, p.id, { kind: 'vote', term: n.term, lastIdx, lastTerm })
    if (n.votes.size >= this.majority) this.becomeLeader(n)
  }

  private onVote(n: Node, m: Msg & { kind: 'vote' }) {
    if (m.term > n.term) {
      this.stepDown(n, m.term)
      n.knownLeader = null
    }
    const lastIdx = n.log.length
    const lastTerm = lastIdx ? n.log[lastIdx - 1].term : 0
    const fresh = m.lastTerm > lastTerm || (m.lastTerm === lastTerm && m.lastIdx >= lastIdx)
    const granted = m.term === n.term && (n.votedFor === null || n.votedFor === m.from) && fresh
    if (granted) {
      n.votedFor = m.from
      this.resetTimer(n)
    }
    this.send(n.id, m.from, { kind: 'voteReply', term: n.term, granted })
  }

  private onVoteReply(n: Node, m: Msg & { kind: 'voteReply' }) {
    if (m.term > n.term) return this.stepDown(n, m.term)
    if (n.role !== 'candidate' || m.term !== n.term || !m.granted) return
    n.votes.add(m.from)
    if (n.votes.size >= this.majority) this.becomeLeader(n)
  }

  private becomeLeader(n: Node, announce = true) {
    n.role = 'leader'
    n.knownLeader = n.id
    n.next = this.nodes.map(() => n.log.length + 1)
    n.match = this.nodes.map(() => 0)
    n.hb = HEARTBEAT
    if (announce) this.replicate(n)
  }

  private deliver(m: Msg) {
    if (m.to < 0) {
      if (m.kind === 'answer') this.onAnswer(m)
      return
    }
    const n = this.nodes[m.to]
    if (!n.alive || !this.reachable(m.from, m.to)) return
    switch (m.kind) {
      case 'book': return this.onBook(n, m)
      case 'copy': return this.onCopy(n, m)
      case 'append': return this.onAppend(n, m)
      case 'appendReply': return this.onAppendReply(n, m)
      case 'vote': return this.onVote(n, m)
      case 'voteReply': return this.onVoteReply(n, m)
    }
  }

  step() {
    this.tick++
    const t = this.tick
    const due = this.msgs.filter((m) => m.arrive <= t)
    this.msgs = this.msgs.filter((m) => m.arrive > t)
    for (const m of due) this.deliver(m)

    if (this.rule) this.clientsStep()

    if (this.rule === 'leader') {
      for (const n of this.active) {
        if (!n.alive) continue
        if (n.role === 'leader') {
          if (--n.hb <= 0) {
            n.hb = HEARTBEAT
            this.replicate(n)
          }
        } else if (this.st.elections && --n.timer <= 0) this.startElection(n)
      }
      this.stallTicks = this.alive().some((n) => n.role === 'leader') ? 0 : this.stallTicks + 1
    } else this.stallTicks = 0

    this.clashEvents = this.clashEvents.filter((e) => t - e.tick <= RECENT)
    this.confirmTicks = this.confirmTicks.filter((c) => t - c <= RECENT)
  }

  get leader(): Node | null {
    const leaders = this.alive().filter((n) => n.role === 'leader')
    return leaders.sort((a, b) => b.term - a.term)[0] ?? null
  }

  get metrics(): ConsensusMetrics {
    const up = this.alive()
    const clashSeats = new Set(this.clashEvents.map((e) => e.seat))
    return {
      confirmed: this.confirmed,
      clashes: clashSeats.size,
      clashTotal: [...this.owners.values()].filter((o) => o.size > 1).length,
      confirmedRecent: this.confirmTicks.length,
      waiting: [...this.requests.values()].filter((r) => !r.done).length,
      leader: this.leader?.id ?? null,
      leaders: up.filter((n) => n.role === 'leader').length,
      term: Math.max(0, ...up.map((n) => n.term)),
      stall: this.stallTicks / TICKS_PER_SECOND,
    }
  }
}
