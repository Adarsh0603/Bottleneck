// Getting a message to a phone:
//
//   Friend ──▶ Server ◀──▶ Phone
//
// The friend sends a message and it reaches the server. A server can only
// answer; it cannot start talking to a phone. So how the phone hears about the
// message depends on the mode:
//
//   manual: the phone asks when you pull to refresh.
//   poll:   the phone asks every few seconds. Most answers are empty.
//   long:   the phone asks and the server holds the ask until it has news,
//           or until a timeout. The phone then asks again at once.
//   sse:    the phone opens one connection. The server writes each message
//           into it. The phone cannot write back through it.
//   ws:     like sse, but the phone can write into it too.
//
// A second, separate part counts a crowd of phones that each hold a
// connection: how many a server can hold, connections that die silently,
// and what happens when a server crashes and they all reconnect.

import type { RealtimeState } from './types'
import type { Place } from './world'
import { TICKS_PER_SECOND } from './world'

const LATENCY = 6 // ticks for a message to cross from one place to the next
const LONG_HOLD = 8 * TICKS_PER_SECOND // ticks the server holds an ask before answering empty
export const SHOWN = 5 // messages on the phone's screen

// The crowd. One phone here stands for many; the numbers are scaled down.
export const CAP_PER_SERVER = 10000 // connections one server can hold
const ACCEPT_PER_SERVER = 2000 // new connections one server can accept each second
const DROP = 0.06 // share of connected phones that vanish silently each second, when flaky
const PING_TIMEOUT = 2 // seconds before the server gives up on a connection that stopped answering
const RETRIES = 5 // attempts each second from a phone that retries at once

interface Wire {
  id: number
  from: Place
  to: Place
  sentAt: number
  arrive: number
}

export type Body =
  | { kind: 'msg'; born: number }
  | { kind: 'ask' }
  | { kind: 'answer'; born: number[] }
  | { kind: 'open' }
  | { kind: 'ready' }
  | { kind: 'push'; born: number }
  | { kind: 'reply' }
  | { kind: 'say' }

export type Msg = Wire & Body

export interface RealtimeMetrics {
  shown: number // messages the phone has shown
  lastDelay: number // seconds the last message took from sent to shown
  streak: number // latest messages in a row that took under a second
  requests: number // requests the phone has made
  empty: number // answers that held nothing
  sent: number // messages the phone sent back
  heard: number // of those, how many reached the friend
  inbox: number // messages waiting at the server for the phone
  held: boolean // the server is holding the phone's ask, or an open connection
  connected: number // phones with a live connection
  dead: number // connections the server still holds for phones that are gone
  waiting: number // phones without a connection
  cap: number // connections all the servers can hold
  recovery: number // seconds the last crash took to heal; -1 until it has
}

// A small seeded generator, so the friend's timing is the same every run.
const seeded = (seed: number) => () => {
  let t = (seed += 0x6d2b79f5)
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

export class RealtimeSim {
  msgs: Msg[] = []
  tick = 0
  inbox: number[] = [] // when each waiting message was sent
  screen = 0 // messages stacked on the phone, capped
  open = false // the server holds an open connection to the phone
  heldAt = -1 // when the server started holding the phone's ask; -1 = not holding one

  private st: RealtimeState = {
    send: 0,
    talk: 0,
    check: 0,
    reply: 0,
    round: 0,
    mode: 'manual',
    interval: 5,
    phones: 1,
    servers: 1,
    flaky: false,
    heartbeat: false,
    backoff: false,
    crash: 0,
  }
  private cfg: string | null = null
  private sendHigh = 0
  private checkHigh = 0
  private replyHigh = 0
  private crashHigh = 0
  private sendDue = 0
  private checkDue = 0
  private replyDue = 0
  private crashDue = 0
  private talkIn = 0
  private pollIn = 0
  private asking = false // an ask is on its way or held
  private opening = false // a connection is being opened
  private rand = seeded(7)
  private msgId = 0

  private shown = 0
  private lastDelay = 0
  private streak = 0
  private requests = 0
  private empty = 0
  private sent = 0
  private heard = 0

  private connected = 0
  private dead = 0
  private waiting = 0
  private crashAt = -1
  private recoveredAt = -1

  apply(st: RealtimeState) {
    const prev = this.st
    this.st = st
    const cfg = `${st.round}`
    const first = this.cfg === null
    const changed = !first && cfg !== this.cfg
    this.cfg = cfg
    // A counter acts only when it passes its highest value, so going back and
    // forward through a chapter does not repeat a message.
    if (first || changed) {
      if (changed) this.reset()
      this.sendHigh = st.send
      this.checkHigh = st.check
      this.replyHigh = st.reply
      this.crashHigh = st.crash
      this.pollIn = st.interval * TICKS_PER_SECOND
      this.connected = Math.min(st.phones, st.servers * CAP_PER_SERVER)
      this.waiting = st.phones - this.connected
    }
    if (st.send > this.sendHigh) {
      this.sendDue += st.send - this.sendHigh
      this.sendHigh = st.send
    }
    if (st.check > this.checkHigh) {
      this.checkDue += st.check - this.checkHigh
      this.checkHigh = st.check
    }
    if (st.reply > this.replyHigh) {
      this.replyDue += st.reply - this.replyHigh
      this.replyHigh = st.reply
    }
    if (st.crash > this.crashHigh) {
      this.crashDue += st.crash - this.crashHigh
      this.crashHigh = st.crash
    }

    if (!first && (prev.mode !== st.mode || prev.interval !== st.interval)) this.switchMode()
    // The counts describe the way in use, so a new way starts them again.
    if (!first && prev.mode !== st.mode) this.shown = this.lastDelay = this.streak = this.requests = this.empty = this.sent = this.heard = 0
    if (st.talk > 0 && this.talkIn <= 0) this.talkIn = this.nextTalk()
    if (st.talk <= 0) this.talkIn = 0
    if (!first && !changed) this.fitCrowd()
  }

  private reset() {
    this.msgs = []
    this.inbox = []
    this.screen = 0
    this.open = false
    this.heldAt = -1
    this.asking = false
    this.opening = false
    this.sendDue = this.checkDue = this.replyDue = this.crashDue = 0
    this.talkIn = 0
    this.rand = seeded(7)
    this.shown = this.lastDelay = this.streak = this.requests = this.empty = this.sent = this.heard = 0
    this.connected = this.dead = this.waiting = 0
    this.crashAt = this.recoveredAt = -1
  }

  // A new way of hearing about messages starts from nothing: no held ask, no connection.
  private switchMode() {
    this.heldAt = -1
    this.asking = false
    this.opening = false
    this.open = false
    this.pollIn = this.st.interval * TICKS_PER_SECOND
  }

  private nextTalk() {
    return Math.max(1, Math.round((TICKS_PER_SECOND / this.st.talk) * (0.6 + 0.8 * this.rand())))
  }

  private get cap() {
    return this.st.servers * CAP_PER_SERVER
  }

  // Match the crowd to the number of phones.
  private fitCrowd() {
    const have = this.connected + this.waiting
    const { phones } = this.st
    if (phones > have) this.waiting += phones - have
    else if (phones < have) {
      let cut = have - phones
      const fromWaiting = Math.min(cut, this.waiting)
      this.waiting -= fromWaiting
      cut -= fromWaiting
      this.connected = Math.max(0, this.connected - cut)
    }
  }

  private send(from: Place, to: Place, body: Body) {
    this.msgs.push({ id: this.msgId++, from, to, sentAt: this.tick, arrive: this.tick + LATENCY, ...body })
  }

  private ask() {
    this.requests++
    this.send('phone', 'server', { kind: 'ask' })
  }

  private show(born: number) {
    this.shown++
    this.screen = Math.min(SHOWN, this.screen + 1)
    this.lastDelay = (this.tick - born) / TICKS_PER_SECOND
    this.streak = this.lastDelay < 1 ? this.streak + 1 : 0
  }

  private answer() {
    this.send('server', 'phone', { kind: 'answer', born: this.inbox })
    this.inbox = []
    this.heldAt = -1
  }

  private flush() {
    for (const born of this.inbox) this.send('server', 'phone', { kind: 'push', born })
    this.inbox = []
  }

  private get pushes() {
    return this.open && (this.st.mode === 'sse' || this.st.mode === 'ws')
  }

  step() {
    this.tick++
    const t = this.tick
    const { mode } = this.st
    const due = this.msgs.filter((m) => m.arrive <= t)
    this.msgs = this.msgs.filter((m) => m.arrive > t)
    for (const m of due) {
      if (m.kind === 'msg') {
        this.inbox.push(m.born)
        if (this.pushes) this.flush()
        else if (this.heldAt >= 0) this.answer()
      } else if (m.kind === 'ask') {
        if (mode === 'long' && !this.inbox.length) this.heldAt = t
        else this.answer()
      } else if (m.kind === 'answer') {
        this.asking = false
        if (!m.born.length) this.empty++
        for (const born of m.born) this.show(born)
      } else if (m.kind === 'open') {
        // A connection opened for a mode the phone has since left is dropped.
        if (mode === 'sse' || mode === 'ws') {
          this.open = true
          this.opening = false
          this.send('server', 'phone', { kind: 'ready' })
          this.flush()
        }
      } else if (m.kind === 'push') {
        this.show(m.born)
      } else if (m.kind === 'reply') {
        this.send('server', 'friend', { kind: 'say' })
      } else if (m.kind === 'say') {
        this.heard++
      }
    }

    // The friend talks.
    while (this.sendDue > 0) {
      this.sendDue--
      this.send('friend', 'server', { kind: 'msg', born: t })
    }
    if (this.st.talk > 0 && --this.talkIn <= 0) {
      this.talkIn = this.nextTalk()
      this.send('friend', 'server', { kind: 'msg', born: t })
    }

    // The phone listens, the way its mode says.
    while (this.checkDue > 0) {
      this.checkDue--
      if (mode === 'manual') this.ask()
    }
    while (this.replyDue > 0) {
      this.replyDue--
      this.sent++
      // On an open WebSocket a reply is one more frame. Anywhere else it is a new request.
      if (!(mode === 'ws' && this.open)) this.requests++
      this.send('phone', 'server', { kind: 'reply' })
    }
    if (mode === 'poll' && --this.pollIn <= 0) {
      this.pollIn = this.st.interval * TICKS_PER_SECOND
      this.ask()
    }
    if (mode === 'long' && !this.asking) {
      this.asking = true
      this.ask()
    }
    if ((mode === 'sse' || mode === 'ws') && !this.open && !this.opening) {
      this.opening = true
      this.requests++
      this.send('phone', 'server', { kind: 'open' })
    }
    if (this.heldAt >= 0 && t - this.heldAt >= LONG_HOLD) this.answer()

    this.stepCrowd()
  }

  private stepCrowd() {
    const dt = 1 / TICKS_PER_SECOND
    const { flaky, heartbeat, backoff, servers } = this.st
    if (flaky && this.connected > 0) {
      const gone = this.connected * DROP * dt
      this.connected -= gone
      this.dead += gone
      this.waiting += gone
    }
    if (heartbeat && this.dead > 0) this.dead -= this.dead * Math.min(1, dt / PING_TIMEOUT)
    if (this.dead < 0.5) this.dead = 0

    while (this.crashDue > 0) {
      this.crashDue--
      const lost = this.connected / servers
      this.connected -= lost
      this.dead -= this.dead / servers
      this.waiting += lost
      this.crashAt = this.tick
      this.recoveredAt = -1
    }

    if (this.waiting > 0) {
      const accept = servers * ACCEPT_PER_SERVER
      // After a crash, a phone that retries at once tries several times a
      // second. A server that is busy turning people away has less time to let
      // anyone in.
      const storm = this.crashAt >= 0 && this.recoveredAt < 0 && !backoff
      const attempts = this.waiting * RETRIES
      const rate = storm && attempts > accept ? accept * (accept / attempts) ** 2 : accept
      const free = Math.max(0, this.cap - this.connected - this.dead)
      let letIn = Math.min(this.waiting, free, rate * dt)
      if (this.waiting - letIn < 0.5 && free >= this.waiting) letIn = this.waiting
      this.waiting -= letIn
      this.connected += letIn
    }
    // Over capacity (a server was taken away): the extra connections are shed.
    const over = this.connected + this.dead - this.cap
    if (over > 0) {
      const deadCut = Math.min(over, this.dead)
      this.dead -= deadCut
      const liveCut = over - deadCut
      this.connected -= liveCut
      this.waiting += liveCut
    }
    if (this.crashAt >= 0 && this.recoveredAt < 0 && this.waiting < 0.5) this.recoveredAt = this.tick
  }

  get metrics(): RealtimeMetrics {
    return {
      shown: this.shown,
      lastDelay: this.lastDelay,
      streak: this.streak,
      requests: this.requests,
      empty: this.empty,
      sent: this.sent,
      heard: this.heard,
      inbox: this.inbox.length,
      held: this.heldAt >= 0 || this.open,
      connected: Math.round(this.connected),
      dead: Math.round(this.dead),
      waiting: Math.round(this.waiting),
      cap: this.cap,
      recovery: this.recoveredAt >= 0 ? (this.recoveredAt - this.crashAt) / TICKS_PER_SECOND : -1,
    }
  }
}
