import type { Ramp, Shot, V3 } from '../../core/types'
import { SAVE_THE_DATABASE } from './build'
import type { CachingSim } from './engine'
import type { CachingChapter, CachingState } from './types'
import { APP, CACHE, DB } from './world'

const BASE: CachingState = {
  rps: 0,
  cache: false,
  capacity: 20,
  ttl: 0,
  coalesce: false,
  cacheDown: false,
  viral: false,
}

const WIDE: Shot = { target: [-1.6, 0.7, 0], zoom: 0.95 }
const APP_DB: Shot = { target: [0.4, 0.8, 0], zoom: 1.05 }
const ON_DB: Shot = { target: [DB.x - 1.4, 0.9, 0], zoom: 1.6 }
const ON_CACHE: Shot = { target: [CACHE.x - 0.4, 0.6, 0], zoom: 1.7 }
const CACHE_LID: Shot = { target: [CACHE.x, 0.7, 0], zoom: 2.6 }
const HITS: Shot = { target: [(APP.x + CACHE.x) / 2, 0.6, 0], zoom: 1.5 }
const MISSES: Shot = { target: [(CACHE.x + DB.x) / 2, 0.7, 0], zoom: 1.5 }
const STAMPEDE: Shot = { target: [2.2, 0.8, 0.4], zoom: 1.4 }

// Tap targets for in-scene questions, just above each piece.
const TARGETS = {
  app: { label: 'App servers', at: [APP.x, APP.h + 0.4, 0] as V3 },
  cache: { label: 'Cache', at: [CACHE.x, CACHE.h + 0.5, 0] as V3 },
  db: { label: 'Database', at: [DB.x, DB.h + 0.5, 0] as V3 },
}

const trafficRamp =(to: number, everyMs: number): Ramp<CachingState> => ({
  everyMs,
  next: (st) => (st.rps >= to ? null : { ...st, rps: Math.floor(st.rps) + 1 }),
})

// Healthy: no errors and the database has room to spare.
const healthy = (sim: CachingSim, maxLoad: number) => {
  const m = sim.metrics
  return m.dropRate < 1 && m.dbLoad < maxLoad
}

export const CHAPTERS: CachingChapter[] = [
  {
    title: 'The database',
    level: 'Beginner',
    initial: { ...BASE, rps: 2 },
    beats: [
      {
        caption: 'Behind every app is a database.',
        sub: 'Your app servers ask it for data on every request.',
        shot: WIDE,
        tags: ['app', 'db'],
        hud: ['traffic', 'latency'],
      },
      {
        caption: 'It handles a few requests a second.',
        sub: 'Each lookup takes it a while. The four boxes on top are its workers.',
        set: { rps: 3 },
        shot: ON_DB,
        tags: ['db'],
        hud: ['traffic', 'dbload'],
      },
      {
        caption: 'Traffic grows. The database drowns.',
        predict: { question: 'Traffic is about to triple. What breaks first?', options: [TARGETS.app, TARGETS.db], answer: 1 },
        sub: 'Your app servers are fine. The database is the bottleneck now.',
        ramp: trafficRamp(10, 900),
        shot: ON_DB,
        tags: ['queue', 'dropped'],
        hud: ['traffic', 'dbload', 'errors'],
      },
      {
        caption: 'But users keep asking for the same things.',
        sub: 'The 10 most popular items get about 70% of all requests.',
        set: { rps: 10 },
        shot: APP_DB,
        hud: ['traffic', 'dbload', 'errors'],
      },
    ],
  },
  {
    title: 'Add a cache',
    level: 'Beginner',
    initial: { ...BASE, rps: 10 },
    beats: [
      {
        caption: 'A cache remembers answers.',
        predict: { question: 'The cache starts empty. Where does the first answer come from?', options: [TARGETS.cache, TARGETS.db], answer: 1 },
        sub: 'Fast memory between your app and the database. It starts empty.',
        set: { cache: true, capacity: 20 },
        shot: ON_CACHE,
        tags: ['cache'],
        hud: ['dbload'],
      },
      {
        caption: 'First time: a miss.',
        sub: 'The cache asks the database, then keeps the answer.',
        shot: MISSES,
        tags: ['miss', 'cache'],
        hud: ['hitrate', 'dbload'],
      },
      {
        caption: 'Next time: a hit.',
        predict: { question: 'Same item, asked again. Where does the answer come from now?', options: [TARGETS.cache, TARGETS.db], answer: 0 },
        sub: 'Answered straight from memory. The database never sees it.',
        shot: HITS,
        tags: ['hit'],
        hud: ['hitrate', 'dbload', 'latency'],
      },
      {
        caption: 'Your turn.',
        sub: 'How big does the cache need to be?',
        set: { capacity: 3 },
        shot: WIDE,
        controls: ['size'],
        tags: ['cache'],
        hud: ['hitrate', 'dbload', 'errors'],
        challenge: {
          goal: 'Keep the database under 75% busy at 10 req/s.',
          win: 'Most requests never reach the database now.',
          holdSeconds: 5,
          check: ({ sim }) => healthy(sim, 0.75),
        },
      },
    ],
  },
  {
    title: 'A full cache',
    level: 'Intermediate',
    initial: { ...BASE, rps: 10, cache: true, capacity: 8 },
    beats: [
      {
        caption: 'A cache can’t hold everything.',
        sub: 'Memory is limited. This one has room for 8 items.',
        shot: CACHE_LID,
        tags: ['cache'],
        hud: ['hitrate'],
      },
      {
        caption: 'Full? Evict the least recently used.',
        sub: 'The item nobody has asked for in the longest time makes room.',
        shot: CACHE_LID,
        tags: ['lru'],
        hud: ['hitrate'],
      },
      {
        caption: 'Bigger cache, more hits. Up to a point.',
        sub: 'The popular items matter most. The long tail rarely gets asked for.',
        shot: WIDE,
        controls: ['size'],
        tags: ['cache'],
        hud: ['hitrate', 'dbload'],
      },
    ],
  },
  {
    title: 'Freshness',
    level: 'Intermediate',
    initial: { ...BASE, rps: 10, cache: true, capacity: 40 },
    beats: [
      {
        caption: 'Cached answers can go stale.',
        sub: 'If the data changes in the database, the cache still has the old copy.',
        shot: ON_CACHE,
        tags: ['cache'],
        hud: ['age', 'hitrate'],
      },
      {
        caption: 'So entries expire after a TTL.',
        sub: 'Time to live. After it, the next request is a miss. Cells fade as they age.',
        set: { ttl: 10 },
        shot: CACHE_LID,
        hud: ['age', 'hitrate', 'dbload'],
      },
      {
        caption: 'Short TTL: fresh data, busy database.',
        sub: 'Expire every 2 seconds and the cache barely helps.',
        set: { ttl: 2 },
        shot: WIDE,
        tags: ['queue'],
        hud: ['age', 'hitrate', 'dbload', 'errors'],
      },
      {
        caption: 'Pick the trade-off.',
        sub: 'Slide the TTL. Watch freshness and database load pull against each other.',
        set: { ttl: 10 },
        shot: WIDE,
        controls: ['ttl'],
        hud: ['age', 'hitrate', 'dbload', 'errors'],
      },
    ],
  },
  {
    title: 'When caches fail',
    level: 'Advanced',
    initial: { ...BASE, rps: 8, cache: true, capacity: 40 },
    beats: [
      {
        caption: 'The cache crashes.',
        sub: 'Every request falls through to the database at once.',
        set: { cacheDown: true },
        shot: WIDE,
        tags: ['db', 'queue'],
        hud: ['dbload', 'errors'],
      },
      {
        caption: 'Back up, but empty.',
        sub: 'A cold cache misses everything until it warms up again.',
        set: { cacheDown: false },
        shot: WIDE,
        tags: ['cache'],
        hud: ['hitrate', 'dbload', 'errors'],
      },
      {
        caption: 'One item goes viral.',
        sub: 'Most traffic is now for one item, and it’s expensive to build.',
        set: { viral: true, ttl: 5 },
        shot: ON_CACHE,
        tags: ['cache'],
        hud: ['hitrate', 'dbload'],
      },
      {
        caption: 'It expires. Everyone misses at once.',
        sub: 'A cache stampede: a burst of identical, expensive queries.',
        shot: STAMPEDE,
        tags: ['queue', 'dropped'],
        hud: ['dbload', 'errors'],
      },
      {
        caption: 'Fix: one request fetches, the rest wait.',
        sub: 'Request coalescing. The database sees one query, not dozens.',
        set: { coalesce: true },
        shot: STAMPEDE,
        tags: ['waiting'],
        hud: ['dbload', 'errors'],
      },
      {
        caption: 'Your turn.',
        sub: 'Same viral item. The data must stay fresh.',
        set: { coalesce: false },
        shot: WIDE,
        controls: ['ttl', 'coalesce'],
        hud: ['age', 'dbload', 'errors'],
        challenge: {
          goal: 'Keep errors under 1% with a TTL of 5 seconds or less.',
          win: 'Coalescing turns a stampede into a single query.',
          holdSeconds: 12,
          check: ({ st, sim }) => st.ttl > 0 && st.ttl <= 5 && healthy(sim, 0.9),
        },
      },
      { caption: 'Ready for the interview.', sub: 'The caching details that come up most.', sheet: true, shot: WIDE },
    ],
  },
  {
    title: 'Build it',
    level: 'Intermediate',
    initial: BASE,
    beats: [{ caption: SAVE_THE_DATABASE.title }],
    build: SAVE_THE_DATABASE,
  },
]
