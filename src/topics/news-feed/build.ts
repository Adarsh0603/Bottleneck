import { createElement } from 'react'
import { Tag } from '../../core/iso/primitives'
import type { BuildTask, Placement, Requirement, Settings } from '../../core/build/types'
import type { FlowSim } from '../../core/flow/engine'
import type { Capstone, Intro, Review } from '../../core/capstone/types'
import { FOLLOWERS, Feed, MODES, SECOND, type Phase } from './feed'

// The design board: writers and readers on the left, a lane for each, the fan-out
// workers and the feed server in the middle, and the feed store on the right.
const WRITERS_AT = { x: -8.8, z: -4.4 }
const READERS_AT = { x: -8.8, z: 4.4 }
const FAN_AT = { x: -1.6, z: -4.4 }
const FEED_AT = { x: -1.6, z: 4.4 }
const STORE_AT = { x: 4.4, z: 0 }
const POS: Record<string, { x: number; z: number }> = {
  a0: { x: -5.2, z: -4.4 },
  a1: { x: -5.2, z: 4.4 },
  w1: { x: -1.6, z: -1.4 },
  w2: { x: 1.4, z: -1.4 },
  s1: { x: 4.4, z: -4.4 },
  s2: { x: 4.4, z: 4.4 },
}
const FIRST_SPOTS = ['a0', 'a1', 'w1', 's1']
const ALL_SPOTS = ['a0', 'a1', 'w1', 'w2', 's1', 's2']
const spot = (id: string) => ({ id, ...POS[id], accepts: [] })

// The first design: ordinary accounts, a busy hour. Then the real day: a rush,
// two posts by a celebrity, and a cache that loses everything.
const T = (s: number) => s * SECOND
const FIRST_PHASES: Phase[] = [{ from: 0, opens: 14, posts: 3 }]
export const FIRST_SETTLED = T(30)
const SCALE_PHASES: Phase[] = [
  { from: 0, opens: 8, posts: 2 },
  { from: T(8), opens: 60, posts: 8 },
  { from: T(20), opens: 60, posts: 12 },
  { from: T(24), opens: 60, posts: 8 },
]
const STARS = [T(30), T(46)]
const COLD_AT = T(40)
export const SCALE_SETTLED = T(62)
const WAIT_LIMIT = 0.8 // seconds a reader may wait for a feed
const FRESH_LIMIT = 3 // seconds a post may take to reach every follower
const FAIL_LIMIT = 3 // readers turned away in all

const TIMELINE: NonNullable<BuildTask['timeline']> = {
  phases: [
    { name: 'A calm morning', from: 0 },
    { name: 'The rush', from: T(8) },
    { name: 'A busy few seconds', from: T(20) },
    { name: 'A celebrity posts', from: T(30) },
    { name: 'The cache dies', from: T(40) },
    { name: 'Another post', from: T(46) },
  ],
  end: SCALE_SETTLED,
}

export const feedOf = new WeakMap<FlowSim, Feed>()

const seeded = (seed: number) => () => {
  let t = (seed += 0x6d2b79f5)
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

// Requests travel left to right. A cache or a queue that stands level with or
// right of the server it should come before has nothing to work with.
function outOfOrder(raw: Placement) {
  const bad = Object.entries(raw).flatMap(([id, kind]) => {
    if (kind === 'cache' && POS[id].x >= FEED_AT.x) return [{ id, why: 'The cache has to stand in front of the feed server, so that most opens are answered before they reach it. Here it does not.' }]
    if (kind === 'queue' && POS[id].x >= FAN_AT.x) return [{ id, why: 'The queue has to stand in front of the fan-out workers, to hold posts for them. Here it does not.' }]
    return []
  })
  return bad.length ? { ids: bad.map((b) => b.id), why: bad[0].why } : null
}

// Which parts are on the floor, and where. A piece can go on any spot, so what it does comes from its kind.
function layout(raw: Placement) {
  const on = (kind: string) => Object.entries(raw).find(([, k]) => k === kind)?.[0]
  const all = (kind: string) => Object.entries(raw).filter(([, k]) => k === kind).map(([id]) => id)
  return {
    queue: on('queue'),
    cache: on('cache'),
    workers: ['fan-0', ...all('app')],
    shards: ['s0', ...all('database')],
    jam: outOfOrder(raw),
  }
}

export function chosen(settings: Settings) {
  return { mode: MODES[settings.mode ?? 0], skipIdle: (settings.idle ?? 0) === 1 }
}

interface Mode {
  phases: Phase[]
  stars: number[]
  coldAt?: number
}

function assemble(raw: Placement, settings: Settings, mode: Mode, rng?: () => number) {
  const l = layout(raw)
  const s = chosen(settings)
  const feed = new Feed(rng ?? seeded(7), {
    mode: s.mode,
    queue: !!l.queue,
    cache: !!l.cache,
    skipIdle: s.skipIdle,
    workers: l.workers,
    shards: l.shards,
    phases: mode.phases,
    stars: mode.stars,
    coldAt: mode.coldAt,
    jam: l.jam?.ids,
    keys: { queue: l.queue ?? 'queue', cache: l.cache ?? 'cache' },
  })
  feedOf.set(feed.flow, feed)
  return feed.flow
}

// The checks a finished design must pass. Shown live; the win needs all green.
const opens = (deadline: number): Requirement => ({
  label: 'Feeds',
  says: `Every reader gets a feed, in under ${WAIT_LIMIT} seconds. No more than ${FAIL_LIMIT} readers turned away in all.`,
  read: (flow) => {
    const f = feedOf.get(flow)
    if (!f) return { text: '', ok: true }
    const slow = flow.tick >= T(4) && f.wait() > WAIT_LIMIT
    const text = f.tally.failed > 0 ? `${f.tally.failed} turned away` : `${f.wait().toFixed(2)} s`
    return { text, ok: f.tally.failed <= FAIL_LIMIT && !slow && (flow.tick < deadline || f.tally.opened > 0) }
  },
})
const posts: Requirement = {
  label: 'Posts',
  says: 'No post may be lost on its way to the followers.',
  read: (flow) => {
    const n = feedOf.get(flow)?.tally.lost ?? 0
    return { text: n === 0 ? 'none lost' : `${n} lost`, ok: n === 0 }
  },
}
const fresh: Requirement = {
  label: 'Fresh',
  says: `A post must reach every follower within ${FRESH_LIMIT} seconds, a celebrity’s as well.`,
  read: (flow) => {
    const f = feedOf.get(flow)
    if (!f) return { text: '', ok: true }
    const slowest = Math.max(f.slowest(), f.slowest(true))
    return { text: `${slowest.toFixed(1)} s`, ok: slowest <= FRESH_LIMIT }
  },
}

const BRIEF = {
  title: 'The brief',
  lines: [
    'A news feed shows you the latest posts from the people you follow. You open the app and it must already be there.',
    'Build one. People post all day. Each reader opens a feed made of the newest posts of everyone they follow.',
    'Plan for 500 million readers who open the app 10 times a day, and 100 million posts a day. People follow about 200 accounts, and a few accounts are followed by tens of millions.',
    'Readers do not wait, and a post is not allowed to take long to arrive.',
  ],
}

const FIXED = [
  { id: 'writers', kind: 'users' as const, ...WRITERS_AT },
  { id: 'readers', kind: 'users' as const, ...READERS_AT },
  { id: 'fan-0', kind: 'app' as const, ...FAN_AT },
  { id: 'feed', kind: 'app' as const, ...FEED_AT },
  { id: 's0', kind: 'database' as const, ...STORE_AT },
]
const LABELS = [
  { at: [WRITERS_AT.x, 1.6, WRITERS_AT.z] as [number, number, number], text: 'Writers' },
  { at: [READERS_AT.x, 1.6, READERS_AT.z] as [number, number, number], text: 'Readers' },
  { at: [FAN_AT.x, 1.6, FAN_AT.z] as [number, number, number], text: 'Fan-out worker' },
  { at: [FEED_AT.x, 1.6, FEED_AT.z] as [number, number, number], text: 'Feed server' },
  { at: [STORE_AT.x, 2.2, STORE_AT.z] as [number, number, number], text: 'Feed store' },
]
const NAMES: BuildTask['names'] = { queue: 'Post queue', cache: 'Feed cache', app: 'Fan-out worker', database: 'Store shard' }
const PIECE_HINTS: BuildTask['hints'] = {
  queue: 'holds posts until a worker is free',
  cache: 'remembers a reader’s feed for a few seconds',
  app: 'copies posts into followers’ inboxes',
  database: 'one more piece of the feed store',
}

const SETTINGS = [
  { id: 'mode', label: 'a post is', when: 'app' as const, min: 0, max: 2, step: 1, initial: 0, options: ['Looked up when a feed opens', 'Copied to every follower', 'Copied, except celebrities’'] },
  { id: 'idle', label: 'copied to', when: 'app' as const, min: 0, max: 1, step: 1, initial: 0, options: ['All followers', 'Active followers only'] },
]

function decorate(flow: FlowSim, raw: Placement) {
  const f = feedOf.get(flow)
  if (!f) return null
  const l = layout(raw)
  const out = [createElement(Tag, { key: 'phase', at: [WRITERS_AT.x, 2.4, WRITERS_AT.z], label: f.cfg.stars.length ? (TIMELINE.phases.filter((p) => p.from <= flow.tick).pop()?.name ?? '') : 'A busy hour' })]
  for (const id of l.jam?.ids ?? []) out.push(createElement(Tag, { key: `jam-${id}`, at: [POS[id].x, 1.8, POS[id].z], label: 'Stops here', danger: true }))
  const load = f.storeLoad()
  out.push(createElement(Tag, { key: 'store', at: [STORE_AT.x, 3.0, STORE_AT.z], label: `Store ${Math.round(load * 100)}% full`, danger: load > 0.75 }))
  const backlog = f.backlog()
  if (backlog > 0) out.push(createElement(Tag, { key: 'backlog', at: [FAN_AT.x, 2.4, FAN_AT.z], label: `${backlog} copies waiting`, danger: backlog > 60 }))
  if (l.cache) out.push(createElement(Tag, { key: 'cache', at: [POS[l.cache].x, 1.6, POS[l.cache].z], label: `${f.tally.opened === 0 ? 0 : Math.round((f.tally.hits / f.tally.opened) * 100)}% answered here` }))
  return out
}

function common(): Pick<BuildTask, 'pinned' | 'manualStart' | 'rps' | 'shot' | 'fixed' | 'labels' | 'decorate' | 'hints' | 'names' | 'failFast' | 'anywhere'> {
  return {
    pinned: BRIEF,
    manualStart: true,
    rps: 4,
    shot: { target: [-2, 0.8, 0], zoom: 0.5 },
    fixed: FIXED,
    labels: LABELS,
    decorate,
    hints: PIECE_HINTS,
    names: NAMES,
    failFast: true,
    anywhere: true,
  }
}

// Stage 2: ordinary accounts, and the new idea: do the work when a post is made.
export const FIRST_DESIGN: BuildTask = {
  ...common(),
  title: 'First design: a busy hour.',
  sub: 'Decide when a post is turned into a feed, and add what helps. Changing anything restarts the run.',
  goal: 'Give every reader a feed in under a second, and get every post to its followers within 3 seconds.',
  goalShort: 'Fast feeds · fresh posts',
  win: 'Copy each post into its followers’ inboxes when it is made, so opening the app is one lookup. Or look up when opened, with a cache that answers most opens.',
  holdSeconds: 4,
  testSeconds: 36,
  pads: FIRST_SPOTS.map(spot),
  toolbox: [
    { kind: 'queue', count: 1 },
    { kind: 'cache', count: 1 },
  ],
  settings: [SETTINGS[0]],
  watch: [{ kind: 'busy', key: 'feed', label: 'Feed server busy' }],
  requirements: [opens(FIRST_SETTLED), posts, fresh],
  assemble: (placed, settings, rng) => assemble(placed, settings, { phases: FIRST_PHASES, stars: [] }, rng),
  problem(_m, raw, settings, flow) {
    const f = feedOf.get(flow)
    if (!f) return null
    const l = layout(raw)
    if (l.jam) return l.jam.why
    const s = chosen(settings)
    if (f.tally.failed > FAIL_LIMIT) {
      if (s.mode === 'read') return 'Readers are turned away. Every open looks up all 16 accounts the reader follows, one by one, and the store cannot answer that many.'
      return 'Readers are turned away: the store is too busy.'
    }
    if (f.tally.lost > 0) return 'Posts are being lost. Copying a post takes many writes, and with nothing to hold the posts, new ones are turned away while a worker is busy.'
    if (f.slowest() > FRESH_LIMIT) return `A post took ${f.slowest().toFixed(1)} seconds to reach its followers.`
    if (f.wait() > WAIT_LIMIT) return `Opening the app takes ${f.wait().toFixed(1)} seconds.`
    return null
  },
  check(_m, _raw, _settings, flow) {
    const f = flow && feedOf.get(flow)
    if (!f || flow.tick < FIRST_SETTLED) return false
    return f.tally.failed <= FAIL_LIMIT && f.tally.lost === 0 && f.wait() <= WAIT_LIMIT && f.slowest() <= FRESH_LIMIT && f.tally.opened > 0
  },
}

// Stage 3: the real day. Each phase brings a new way to fail.
export const SCALE_UP: BuildTask = {
  ...common(),
  title: 'Where it breaks: a celebrity.',
  sub: 'A rush of readers, a celebrity with hundreds of followers’ worth of copies, and a cache that dies. Watch what turns red, then fix it.',
  goal: 'Get through the whole day: nobody turned away, no post lost, every post fresh.',
  goalShort: 'Survive the whole day',
  win: 'Copy normal accounts’ posts, look the celebrity up when a feed opens, queue the posts, keep a cache, and give the store more than one shard.',
  holdSeconds: 4,
  testSeconds: 66,
  pads: ALL_SPOTS.map(spot),
  toolbox: [
    { kind: 'queue', count: 1 },
    { kind: 'cache', count: 1 },
    { kind: 'app', count: 2 },
    { kind: 'database', count: 2 },
  ],
  timeline: TIMELINE,
  settings: SETTINGS,
  watch: [{ kind: 'busy', key: 'feed', label: 'Feed server busy' }],
  requirements: [opens(SCALE_SETTLED), posts, fresh],
  assemble: (placed, settings, rng) => assemble(placed, settings, { phases: SCALE_PHASES, stars: STARS, coldAt: COLD_AT }, rng),
  problem(_m, raw, settings, flow) {
    const f = feedOf.get(flow)
    if (!f) return null
    const l = layout(raw)
    if (l.jam) return l.jam.why
    const s = chosen(settings)
    const tick = flow.tick
    if (f.tally.failed > FAIL_LIMIT) {
      if (s.mode === 'read') return 'Readers are turned away. In the rush, every open looks up all the accounts the reader follows, and the store cannot keep up.'
      if (tick >= COLD_AT && !l.cache) return 'Readers are turned away: with no cache, every open reaches the store.'
      if (tick >= COLD_AT) return 'Readers are turned away when the cache dies: all its opens land on the store at once.'
      return 'Readers are turned away: the store is too busy.'
    }
    if (f.tally.lost > 0) {
      if (!l.queue) return 'Posts are being lost. A worker busy copying the celebrity’s post turns new posts away, and nothing holds them.'
      return 'Posts are being lost: the post queue is full. The workers cannot get their copies into the store fast enough, because readers keep it busy.'
    }
    if (f.slowest(true) > FRESH_LIMIT || f.slowest() > FRESH_LIMIT) {
      if (s.mode === 'write') return `A post took ${Math.max(f.slowest(), f.slowest(true)).toFixed(1)} seconds to reach its followers. The celebrity has ${FOLLOWERS.star} followers’ worth of copies to write, and everyone behind the post waits.`
      return 'Posts take too long to arrive. The workers cannot copy them fast enough.'
    }
    if (f.wait() > WAIT_LIMIT) return `Opening the app takes ${f.wait().toFixed(1)} seconds.`
    return null
  },
  check(_m, _raw, _settings, flow) {
    const f = flow && feedOf.get(flow)
    if (!f || flow.tick < SCALE_SETTLED) return false
    return f.tally.failed <= FAIL_LIMIT && f.tally.lost === 0 && f.wait() <= WAIT_LIMIT && f.slowest() <= FRESH_LIMIT && f.slowest(true) <= FRESH_LIMIT
  },
}

function review(raw: Placement, settings: Settings): Review {
  const l = layout(raw)
  const s = chosen(settings)
  const MODE_NAME = { read: 'Look up when opened', write: 'Copy to every follower', hybrid: 'Copy, except celebrities’' }
  return {
    lines: [
      { label: 'When', yours: MODE_NAME[s.mode], reference: 'Copy normal accounts’ posts, look celebrities up when a feed opens', why: 'Reads outnumber posts by far, so do the work when a post is made. But one post by a celebrity would be tens of millions of copies, so that one is looked up when the feed opens.', ok: s.mode === 'hybrid' },
      { label: 'Post queue', yours: l.queue ? 'A queue in front of the workers' : 'None', reference: 'A queue in front of the workers', why: 'Posts arrive in bursts. A queue holds them while the workers catch up, so none is turned away.', ok: !!l.queue },
      { label: 'Feed cache', yours: l.cache ? 'A cache in front of the feed server' : 'None', reference: 'A cache in front of the feed server', why: 'The same readers open the app again and again. A cache answers most opens without the store, and absorbs the rush.', ok: !!l.cache },
      { label: 'Workers', yours: `${l.workers.length} fan-out worker${l.workers.length > 1 ? 's' : ''}`, reference: '2 or more fan-out workers', why: 'One worker copies a few writes a tick. More workers copy more posts at once.', ok: l.workers.length >= 2 },
      { label: 'Store', yours: `${l.shards.length} shard${l.shards.length > 1 ? 's' : ''}`, reference: '2 or more shards', why: 'Lookups and writes share the store. Split over shards, a burst of writes does not starve the readers.', ok: l.shards.length >= 2 },
    ],
    tradeoffs: [
      'The cache shows a feed that can be a few seconds old. Readers rarely notice, and the store is spared.',
      'Hybrid means two ways to build a feed. Every feed merges the inbox with the celebrities it follows, so the feed server does more per open.',
      'Skipping idle followers saves writes, but a returning reader has no inbox: their open looks up every account they follow, and skips the cache. Enough of those at once and the store is swamped.',
      'Where to draw the line for a celebrity is a choice: a follower count, or a rate of posting. Too low and the lookups grow, too high and the copies hurt.',
    ],
    interview: [
      'Clarify: how many readers and posts, how fresh must a feed be, how is the feed ordered, are there celebrities, images or video.',
      'Estimate: 500 million readers opening 10 times a day is about 58,000 opens a second. 100 million posts a day is about 1,200 a second, and 200 followers each is about 240,000 copies a second.',
      'Design: post service, queue, fan-out workers, feed store sharded by reader, feed cache, feed server that merges.',
      'Scale: copy at post time for normal accounts, look celebrities up at open time, skip inactive followers, cache feeds.',
      'Failures: a cold cache can flood the store, so warm it or rate-limit it. Retry copies that fail.',
    ],
  }
}

// The opening: a tiny feed, from a post to a reader.
const INTRO_FIXED = [
  { id: 'writers', kind: 'users' as const, x: -8, z: -3 },
  { id: 'fan-0', kind: 'app' as const, x: -3, z: -3 },
  { id: 's0', kind: 'database' as const, x: 2.4, z: 0 },
  { id: 'feed', kind: 'app' as const, x: -3, z: 3 },
  { id: 'readers', kind: 'users' as const, x: -8, z: 3 },
]
export const INTRO: Intro = {
  task: {
    title: 'How a news feed works',
    sub: '',
    goal: '',
    win: '',
    holdSeconds: 1,
    rps: 1,
    shot: { target: [-2.4, 0.8, 0], zoom: 0.85 },
    fixed: INTRO_FIXED,
    pads: [],
    toolbox: [],
    assemble: (_placed, _settings, rng) => {
      const feed = new Feed(rng ?? seeded(3), {
        mode: 'write',
        queue: false,
        cache: false,
        skipIdle: false,
        workers: ['fan-0'],
        shards: ['s0'],
        phases: [{ from: 0, opens: 2, posts: 1 }],
        stars: [],
        keys: { queue: 'queue', cache: 'cache' },
      })
      feedOf.set(feed.flow, feed)
      return feed.flow
    },
    check: () => false,
  },
  steps: [
    { say: 'People post all day. Someone you follow posts a photo.', at: 'writers', label: 'A post' },
    { say: 'A worker copies the post into the inbox of everyone who follows its author. This is called fan-out.', at: 'fan-0', label: 'Fan-out worker' },
    { say: 'The inboxes live in the feed store. Each reader has one, already holding the newest posts.', at: 's0', label: 'Feed store' },
    { say: 'When you open the app, the feed server reads your inbox and sends it back. One lookup, no searching.', at: 'feed', label: 'Feed server' },
    { say: 'Your feed is on screen. Easy for a few friends. Now picture a celebrity with 50 million followers.' },
  ],
  start: 'Take the challenge →',
}

export const NEWS_FEED: Capstone = {
  id: 'news-feed',
  title: 'News feed',
  stages: ['Requirements', 'First design', 'Where it breaks', 'Final review'],
  intro: INTRO,
  goals: ['Fast feeds', 'Fresh posts', 'No post lost', 'Survive a celebrity'],
  brief: BRIEF,
  estimate: {
    intro: 'Before drawing anything, work out how big this is. A few quick numbers decide the design.',
    summary: { title: 'About 58,000 opens a second, and copying costs only 240,000 writes.', body: 'Reading every followed account on every open is 12 million lookups a second. Copying once when a post is made is far cheaper. Except for a celebrity, whose one post is tens of millions of copies.' },
    questions: [
      { question: '500 million people open the app 10 times a day. About how many opens a second?', options: ['About 5,800', 'About 58,000', 'About 580,000'], answer: 1, at: 'readers', show: '58,000 opens / second', why: '5 billion opens a day ÷ 86,400 seconds is about 58,000.' },
      { question: '100 million posts a day. About how many posts a second?', options: ['About 120', 'About 1,200', 'About 12,000'], answer: 1, at: 'writers', show: '1,200 posts / second', why: '100,000,000 ÷ 86,400 is about 1,200. Reads outnumber writes about 50 to 1.' },
      { question: 'Without copies, each open looks up the 200 accounts the reader follows. About how many lookups a second?', options: ['About 120,000', 'About 1.2 million', 'About 12 million'], answer: 2, at: 'feed', show: '12 million lookups / second', why: '58,000 opens × 200 accounts is about 12 million lookups a second. No store takes that.' },
      { question: 'With copies, each post is written into the inbox of each of its 200 followers. About how many writes a second?', options: ['About 24,000', 'About 240,000', 'About 2.4 million'], answer: 1, at: 's0', show: '240,000 writes / second', why: '1,200 posts × 200 followers is about 240,000 writes a second. Much less than 12 million lookups, so do the work when a post is made.' },
      { question: 'A celebrity with 50 million followers posts once. How many writes is that?', options: ['About 50,000', 'About 500,000', 'About 50 million'], answer: 2, at: 'fan-0', show: '50 million writes', why: 'One write per follower: 50 million for a single post. Copying every post this way would bury the store.' },
    ],
  },
  first: FIRST_DESIGN,
  scale: SCALE_UP,
  review,
}
