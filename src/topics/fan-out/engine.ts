// Getting posts to the people who follow:
//
//   People you follow ──▶ Post store ◀──▶ Feed server ◀──▶ You
//                              │               ▲
//                              └──▶ Inboxes ───┘
//
// People post into the store all day. What happens next depends on the mode:
//
//   read:   nothing. When the reader opens the app, the server makes one lookup
//           per person they follow. The store answers one at a time.
//   write:  a worker copies each post into every follower's inbox, one write at
//           a time. Opening the app is then one lookup in the reader's inbox.
//   hybrid: normal accounts are copied into inboxes. A celebrity is not, so the
//           server adds one lookup for the celebrity when it builds the feed.
//
// Either way the server merges what it got, newest first, and sends the feed.

import type { FanoutState, Mode } from './types'
import type { Place } from './world'
import { AUTHORS, authorPlace, TICKS_PER_SECOND } from './world'

const LATENCY = 8 // ticks for a message to cross from one place to the next
const SERVE = 1 // ticks the store needs for one lookup
const WRITE = 1 // ticks the inboxes need for one write
const MERGE = 2 // ticks the server needs to merge the answers
const KEEP = 60 // posts the store and the inbox remember
const RECENT = 10 * TICKS_PER_SECOND // ticks the "slowest" figure looks back over
export const SHOWN = 5 // posts on the reader's screen

// Followers per account. A real celebrity has millions, so one post here
// stands for millions of writes.
export const FOLLOWERS = { normal: 5, star: 200 }
// The share of followers who have been away for a long time.
export const IDLE_SHARE = 0.6

interface Wire {
  id: number
  from: Place
  to: Place
  sentAt: number
  arrive: number
}

export type Body =
  | { kind: 'post'; star: boolean }
  | { kind: 'write'; seq: number; star: boolean }
  | { kind: 'open'; n: number }
  | { kind: 'lookup'; n: number }
  | { kind: 'rows'; n: number }
  | { kind: 'feed'; n: number; stars: boolean[] }

export type Msg = Wire & Body

interface Post {
  seq: number
  star: boolean
}

export interface FanoutMetrics {
  opened: number // feeds delivered
  waiting: number // opens not yet answered
  lookups: number // lookups the server has made
  lastWait: number // seconds the last feed took
  queue: number // lookups waiting at the store
  posted: number // posts saved
  writes: number // inbox writes done
  backlog: number // inbox writes waiting
  slowest: number // seconds the slowest normal post of the last 10 seconds took to reach every inbox
  starPosts: number // posts by the celebrity
  starWrites: number // inbox writes the celebrity's last post needed
  delivered: number // posts that reached every inbox
}

export class FanoutSim {
  msgs: Msg[] = []
  tick = 0
  posts: Post[] = [] // saved in the store, oldest first
  inbox: Post[] = [] // posts that reached every inbox, oldest first
  feed: boolean[] = [] // the posts on the reader's screen, newest first: is it the celebrity's?
  storeQueue: number[] = [] // the open each waiting lookup belongs to
  writeQueue: number[] = [] // the post each waiting write belongs to
  busy: { n: number; doneAt: number } | null = null
  busyWrite: { seq: number; doneAt: number } | null = null
  lastFeedAt = -1000

  private opens = new Map<number, { need: number; got: number; at: number; mode: Mode }>()
  private jobs = new Map<number, { post: Post; left: number; at: number }>()
  private merging: { n: number; mode: Mode; readyAt: number }[] = []
  private recent: { at: number; delay: number }[] = []
  private opened = 0
  private lookups = 0
  private lastWait = 0
  private posted = 0
  private writes = 0
  private delivered = 0
  private starPosts = 0
  private starWrites = 0

  private st: FanoutState = { open: 0, pace: 0, posting: 0, follows: 4, round: 0, mode: 'read', celeb: false, star: 0, skipIdle: false }
  private cfg: string | null = null
  private openHigh = 0 // the highest `open` already acted on, so going back and forward does not repeat it
  private openDue = 0
  private starHigh = 0
  private starDue = 0
  private openId = 0
  private seq = 0
  private autoIn = 0
  private postIn = 0
  private postAt = 0
  private msgId = 0

  apply(st: FanoutState) {
    this.st = st
    const cfg = `${st.round}`
    const first = this.cfg === null
    const changed = !first && cfg !== this.cfg
    this.cfg = cfg
    // A sim created partway through a chapter does not replay earlier opens or
    // posts. Going back and forward again does not repeat them either: only a
    // counter that passes its highest value acts.
    if (first) {
      this.openHigh = st.open
      this.starHigh = st.star
    }
    if (changed) {
      this.reset()
      this.openHigh = st.open
      this.starHigh = st.star
    }
    if (st.open > this.openHigh) {
      this.openDue += st.open - this.openHigh
      this.openHigh = st.open
    }
    if (st.star > this.starHigh) {
      this.starDue += st.star - this.starHigh
      this.starHigh = st.star
    }
    if (st.pace > 0 && this.autoIn <= 0) this.autoIn = Math.round(TICKS_PER_SECOND / 2)
    if (st.pace <= 0) this.autoIn = 0
    if (st.posting > 0 && this.postIn <= 0) this.postIn = Math.round(TICKS_PER_SECOND / st.posting)
    if (st.posting <= 0) this.postIn = 0
  }

  private reset() {
    this.msgs = []
    this.posts = []
    this.inbox = []
    this.feed = []
    this.storeQueue = []
    this.writeQueue = []
    this.busy = null
    this.busyWrite = null
    this.lastFeedAt = -1000
    this.opens.clear()
    this.jobs.clear()
    this.merging = []
    this.recent = []
    this.opened = this.lookups = this.lastWait = this.posted = this.writes = this.delivered = this.starPosts = this.starWrites = 0
    this.openDue = 0
    this.starDue = 0
    this.autoIn = 0
    this.postIn = 0
    this.postAt = 0
  }

  // The normal accounts that post: the ones drawn on the floor, or fewer if the reader follows fewer.
  get authors() {
    return Math.max(1, Math.min(this.st.follows, this.st.celeb ? AUTHORS - 1 : AUTHORS))
  }

  // Inbox writes one post needs: one per follower, fewer when idle followers are skipped.
  private writesFor(star: boolean) {
    const followers = star ? FOLLOWERS.star : FOLLOWERS.normal
    return Math.ceil(followers * (this.st.skipIdle ? 1 - IDLE_SHARE : 1))
  }

  private send(from: Place, to: Place, body: Body) {
    this.msgs.push({ id: this.msgId++, from, to, sentAt: this.tick, arrive: this.tick + LATENCY, ...body })
  }

  private open() {
    const { mode, follows, celeb } = this.st
    const need = mode === 'read' ? follows : mode === 'write' ? 1 : 1 + (celeb ? 1 : 0)
    const n = ++this.openId
    this.opens.set(n, { need, got: 0, at: this.tick, mode })
    this.send('reader', 'server', { kind: 'open', n })
  }

  private post(star: boolean) {
    const from = star ? authorPlace(AUTHORS - 1) : authorPlace(this.postAt++ % this.authors)
    this.send(from, 'store', { kind: 'post', star })
  }

  // A post reached the store. In write mode, and for normal accounts in hybrid
  // mode, it is copied to every follower's inbox.
  private save(star: boolean) {
    const post = { seq: ++this.seq, star }
    this.posts.push(post)
    if (this.posts.length > KEEP) this.posts.shift()
    this.posted++
    if (star) this.starPosts++
    const { mode } = this.st
    if (mode === 'read' || (mode === 'hybrid' && star)) return
    const count = this.writesFor(star)
    if (star) this.starWrites = count
    this.jobs.set(post.seq, { post, left: count, at: this.tick })
    for (let i = 0; i < count; i++) this.send('store', 'inbox', { kind: 'write', seq: post.seq, star })
  }

  private finishWrite(seq: number) {
    const job = this.jobs.get(seq)
    this.writes++
    if (!job || --job.left > 0) return
    this.jobs.delete(seq)
    this.inbox.push(job.post)
    if (this.inbox.length > KEEP) this.inbox.shift()
    this.delivered++
    if (!job.post.star) {
      this.recent.push({ at: this.tick, delay: (this.tick - job.at) / TICKS_PER_SECOND })
    }
  }

  private serve() {
    if (this.busy && this.busy.doneAt <= this.tick) {
      this.send('store', 'server', { kind: 'rows', n: this.busy.n })
      this.busy = null
    }
    if (!this.busy && this.storeQueue.length) this.busy = { n: this.storeQueue.shift()!, doneAt: this.tick + SERVE }
  }

  private deliver() {
    if (this.busyWrite && this.busyWrite.doneAt <= this.tick) {
      this.finishWrite(this.busyWrite.seq)
      this.busyWrite = null
    }
    if (!this.busyWrite && this.writeQueue.length) this.busyWrite = { seq: this.writeQueue.shift()!, doneAt: this.tick + WRITE }
  }

  // The newest posts for a feed built in the given mode, newest first.
  private feedFor(mode: Mode): boolean[] {
    let pool: Post[]
    if (mode === 'read') pool = this.posts
    else if (mode === 'write') pool = this.inbox
    else {
      const bySeq = new Map<number, Post>()
      for (const p of [...this.inbox, ...this.posts.filter((x) => x.star)]) bySeq.set(p.seq, p)
      pool = [...bySeq.values()].sort((a, b) => a.seq - b.seq)
    }
    return pool.slice(-SHOWN).reverse().map((p) => p.star)
  }

  private merge() {
    for (const m of this.merging.filter((x) => x.readyAt <= this.tick)) {
      this.send('server', 'reader', { kind: 'feed', n: m.n, stars: this.feedFor(m.mode) })
    }
    this.merging = this.merging.filter((x) => x.readyAt > this.tick)
  }

  step() {
    this.tick++
    const t = this.tick
    const due = this.msgs.filter((m) => m.arrive <= t)
    this.msgs = this.msgs.filter((m) => m.arrive > t)
    for (const m of due) {
      if (m.kind === 'post') {
        this.save(m.star)
      } else if (m.kind === 'write') {
        this.writeQueue.push(m.seq)
      } else if (m.kind === 'open') {
        const o = this.opens.get(m.n)
        if (!o) continue
        if (o.mode === 'read') for (let i = 0; i < o.need; i++) this.send('server', 'store', { kind: 'lookup', n: m.n })
        else {
          this.send('server', 'inbox', { kind: 'lookup', n: m.n })
          if (o.mode === 'hybrid' && o.need > 1) this.send('server', 'store', { kind: 'lookup', n: m.n })
        }
        this.lookups += o.need
      } else if (m.kind === 'lookup') {
        // An inbox answers at once. The store answers one lookup at a time.
        if (m.to === 'inbox') this.send('inbox', 'server', { kind: 'rows', n: m.n })
        else this.storeQueue.push(m.n)
      } else if (m.kind === 'rows') {
        const o = this.opens.get(m.n)
        if (!o) continue
        o.got++
        if (o.got >= o.need) this.merging.push({ n: m.n, mode: o.mode, readyAt: t + MERGE })
      } else {
        const o = this.opens.get(m.n)
        if (!o) continue
        this.feed = m.stars
        this.opened++
        this.lastWait = (t - o.at) / TICKS_PER_SECOND
        this.lastFeedAt = t
        this.opens.delete(m.n)
      }
    }

    while (this.openDue > 0) {
      this.openDue--
      this.open()
    }
    while (this.starDue > 0) {
      this.starDue--
      if (this.st.celeb) this.post(true)
    }
    if (this.st.pace > 0 && --this.autoIn <= 0) {
      this.autoIn = Math.round(TICKS_PER_SECOND / this.st.pace)
      this.open()
    }
    if (this.st.posting > 0 && --this.postIn <= 0) {
      this.postIn = Math.round(TICKS_PER_SECOND / this.st.posting)
      this.post(false)
    }

    this.serve()
    this.deliver()
    this.merge()
  }

  get metrics(): FanoutMetrics {
    return {
      opened: this.opened,
      waiting: this.opens.size,
      lookups: this.lookups,
      lastWait: this.lastWait,
      queue: this.storeQueue.length + (this.busy ? 1 : 0),
      posted: this.posted,
      writes: this.writes,
      backlog: this.writeQueue.length + (this.busyWrite ? 1 : 0),
      slowest: Math.max(0, ...this.recent.filter((r) => this.tick - r.at < RECENT).map((r) => r.delay)),
      starPosts: this.starPosts,
      starWrites: this.starWrites,
      delivered: this.delivered,
    }
  }
}
