import { TICKS_PER_SECOND } from '../../core/build/run'
import type { BuildTask } from '../../core/build/types'
import { Cache } from '../../core/flow/cache'
import { FlowSim, type FlowNode } from '../../core/flow/engine'
import { Source, Worker } from '../../core/flow/nodes'
import { ITEMS, popularItem } from './engine'
import { APP, CACHE, DB, USERS_X } from './world'

// Build it: the database is drowning at 10 req/s. One pad between the app
// servers and the database.
//   - Nothing there: every request hits the database.
//   - A server there (the decoy): it just passes requests through.
//   - A cache there: popular items get answered from memory, but only if
//     it's big enough to hold them.
// Prices change all the time, and 12 seconds in a different set of items
// becomes the popular one. A cache that keeps items too long shows old
// prices; one that keeps them too briefly sends the database more work than
// it can take.

const RPS = 10
const SHIFT_TICK = 12 * TICKS_PER_SECOND // when different items become popular
const SHIFT_BY = 20
const OLD_AFTER = 7 * TICKS_PER_SECOND // a price this long in the cache is likely to have changed
const SETTLED_TICK = 32 * TICKS_PER_SECOND // the new popular items have warmed up, and old copies have had time to go stale
const STALE_LIMIT = 25 // percent of cached answers that may be out of date
const WINDOW = 10 * TICKS_PER_SECOND
const MIN_ANSWERS = 25
const KEEP_SECONDS = [3, 8, 30, Infinity]

const hotItem = (tick: number, rng: () => number) => (popularItem(rng) + (tick >= SHIFT_TICK ? SHIFT_BY : 0)) % ITEMS

// Counts how many answers from the cache were out of date, over the last few
// seconds. Prices change all the time, so a copy older than OLD_AFTER is
// counted as out of date. That depends only on how long the cache keeps
// items, so the same settings always give the same result.
class Prices implements FlowNode {
  alive = true
  readonly key = 'prices'
  private copied = new Map<number, number>() // item → tick its copy was made
  private hits = 0
  private stale = 0
  private history: { hits: number; stale: number }[] = []
  private cache?: Cache

  constructor(cache?: Cache) {
    this.cache = cache
  }

  receive() {}

  // The database has just read `key`: that's the copy the cache keeps.
  read(key: number, tick: number) {
    this.copied.set(key, tick)
  }

  process(sim: FlowSim) {
    const cache = this.cache
    if (cache) {
      const fresh = cache.hits - this.hits
      this.hits = cache.hits
      const hits = fresh > 0 ? cache.events.filter((e) => e.kind === 'hit').slice(-fresh) : []
      for (const e of hits) if (sim.tick - (this.copied.get(e.key) ?? 0) > OLD_AFTER) this.stale++
    }
    this.history.push({ hits: this.hits, stale: this.stale })
    if (this.history.length > WINDOW) this.history.shift()
  }

  // Percent of the cache's recent answers that were out of date.
  staleRate() {
    const first = this.history[0]
    const last = this.history[this.history.length - 1]
    // A handful of answers says nothing yet (one stale of three is not 33%).
    if (!first || !last || last.hits - first.hits < MIN_ANSWERS) return 0
    return ((last.stale - first.stale) / (last.hits - first.hits)) * 100
  }
}

export const SAVE_THE_DATABASE: BuildTask = {
  title: 'Build it: save the database.',
  sub: 'Put something between the app and the database, then tune it.',
  brief: [
    'Your shop shows product pages to 10 shoppers a second. Every page comes from the database, which can only look up about 5 things a second. It is drowning.',
    'A cache keeps copies of the pages people ask for most, so the database is asked only for the rest. It has two settings: how many items it can hold, and how long it keeps each one.',
    'Prices change all the time. A copy that is kept too long shows a price that is no longer true. A copy that is thrown away too soon has to be fetched from the database again.',
    'Twelve seconds in, a new product goes viral and a different set of items becomes the popular ones. The cache has to catch up.',
  ],
  manualStart: true,
  goal: `Keep the database under 75% busy, with under ${STALE_LIMIT}% of answers out of date.`,
  goalShort: 'Database under 75% busy, answers up to date.',
  win: 'A cache big enough for the popular items, and kept just long enough.',
  replies: () => true,
  holdSeconds: 6,
  testSeconds: 38,
  rps: RPS,
  shot: { target: [-1.4, 0.7, 0], zoom: 0.95 },
  fixed: [
    { id: 'users', kind: 'users', x: USERS_X, z: 0 },
    { id: 'app', kind: 'app', x: APP.x, z: 0 },
    { id: 'database', kind: 'database', x: DB.x, z: 0 },
  ],
  pads: [{ id: 'middle', x: CACHE.x, z: 0, accepts: ['cache', 'server'] }],
  toolbox: [
    { kind: 'cache', count: 1 },
    { kind: 'server', count: 1 },
  ],
  settings: [
    { id: 'size', label: 'item', when: 'cache', min: 5, max: 40, step: 5, initial: 5 },
    { id: 'keep', label: 'Keep for', when: 'cache', min: 0, max: 3, step: 1, initial: 3, options: ['3 s', '8 s', '30 s', 'Forever'] },
  ],
  watch: [
    { kind: 'busy', key: 'database', label: 'Database busy' },
    {
      kind: 'note',
      label: 'Out of date',
      read: (flow) => {
        const rate = (flow.node('prices') as Prices | undefined)?.staleRate() ?? 0
        return { text: `${rate.toFixed(0)}%`, bad: rate >= STALE_LIMIT }
      },
    },
  ],

  assemble(placed, settings, rng) {
    const flow = new FlowSim(rng)
    const users = flow.add(new Source('users'))
    users.rate = RPS / TICKS_PER_SECOND
    users.keyOf = (r) => hotItem(flow.tick, r)
    flow.add(new Worker('app', { slots: 32, queueLimit: 64, workPerRequest: 2 }))
    const db = flow.add(new Worker('database', { slots: 4, queueLimit: 20, workPerRequest: 15 }))
    flow.link('users', 'app', 8)

    const middle = placed.middle
    let cache: Cache | undefined
    if (middle === 'cache') {
      cache = flow.add(new Cache('middle'))
      cache.capacity = settings.size ?? 5
      cache.ttl = KEEP_SECONDS[settings.keep ?? 3] * TICKS_PER_SECOND
      // Shoppers asking for an item that is already being fetched wait for it
      // instead of each sending the database their own lookup.
      cache.coalesce = false
    }
    const prices = flow.add(new Prices(cache))
    if (cache) {
      // The shop has been open a while: the cache already holds the most
      // popular items, so traffic doesn't start against an empty cache.
      for (let k = 0; k < cache.capacity; k++) {
        prices.read(k, 0)
        cache.fill(k, flow)
      }
      db.onFinish = (job, sim) => {
        if (job.key === undefined) return
        prices.read(job.key, sim.tick)
        cache.fill(job.key, sim)
      }
    }
    if (middle === 'server') flow.add(new Worker('middle', { slots: 8, queueLimit: 16, workPerRequest: 2 }))
    if (middle) {
      flow.link('app', 'middle', 5)
      flow.link('middle', 'database', 6)
    } else {
      flow.link('app', 'database', 10)
    }
    return flow
  },

  problem: (m, placed, settings, flow) => {
    if (placed.middle !== 'cache') return flow.tick > 40 && (m.busy.database ?? 0) >= 0.75 ? 'Every request still reaches the database.' : null
    const stale = (flow.node('prices') as Prices | undefined)?.staleRate() ?? 0
    if (stale >= STALE_LIMIT) return 'Shoppers are being shown old prices. The cache keeps items for too long.'
    if ((m.busy.database ?? 0) >= 0.75 || m.dropRate > 1) {
      return settings.keep === 0 ? 'Items expire so fast that the database keeps being asked again.' : 'Too many requests miss the cache and reach the database.'
    }
    return null
  },

  // Judged only once the new popular items have had time to warm up.
  check: (m, placed, _settings, flow) => {
    const stale = (flow?.node('prices') as Prices | undefined)?.staleRate() ?? 0
    return (
      placed.middle === 'cache' &&
      !!flow &&
      flow.tick > SETTLED_TICK &&
      m.dropRate < 1 &&
      (m.busy.database ?? 1) < 0.75 &&
      stale < STALE_LIMIT
    )
  },
}
