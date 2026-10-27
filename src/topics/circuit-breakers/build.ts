import { createElement } from 'react'
import { IsoBox, Tag } from '../../core/iso/primitives'
import type { BuildTask } from '../../core/build/types'
import type { FlowSim } from '../../core/flow/engine'
import { COOLDOWNS, DEP_NAMES, MODE_NAMES, POOLS, SECOND, Shop, TIMEOUTS, TRIPS, type Backoff, type Dep, type Mode } from './shop'
import { DEP_AT, GATE_AT, SHOP, USERS } from './world'

// Build it: the weekend sale. Customers browse and check out. A product page
// shows reviews, and a checkout calls Payments. The learner stands between the
// shop and the two services, and picks how the shop treats a call. Nothing is
// said about when the trouble starts:
//   - for the first 4 seconds all is calm
//   - then Reviews goes slow, 5 seconds a call, and stays that way
//   - at 12 seconds Payments goes down for 10 seconds
//   - from 32 seconds every fourth call to Payments hangs
// The shop has 6 threads. Reviews is a nice extra: a page can show saved
// ratings, if it has somewhere to keep them. Payments is not: a checkout either
// goes through or fails, and the point is to fail it quickly. A rate limiter at
// the door turns away real customers, and more threads only delay the end.
//
// Settings: how long to wait for a call, how many times to retry and how, how
// many threads one service may hold, and when a breaker opens and tests again.

const CALM = 4 * SECOND
const REV_SLOW_AT = CALM
const PAY_DOWN_AT = 12 * SECOND
const PAY_BACK_AT = 22 * SECOND
const STUCK_AT = 32 * SECOND
const SETTLED = 50 * SECOND
const THREADS = 6
const EXTRA_THREADS = 4

const script = (dep: Dep, tick: number): Mode => {
  if (dep === 'rev') return tick < REV_SLOW_AT ? 'ok' : 'slow'
  if (tick < PAY_DOWN_AT) return 'ok'
  if (tick < PAY_BACK_AT) return 'down'
  return tick < STUCK_AT ? 'ok' : 'mixed'
}

export const shopOf = new WeakMap<FlowSim, Shop>()

const BACKOFFS: Backoff[] = ['none', 'exp', 'jitter']

// What the learner has chosen.
export function chosen(settings: Record<string, number>) {
  return {
    timeout: TIMEOUTS[settings.timeout ?? 5],
    retries: settings.retries ?? 0,
    backoff: BACKOFFS[settings.backoff ?? 0],
    pool: POOLS[settings.pool ?? 0],
    trip: TRIPS[settings.trip ?? 2],
    cooldown: COOLDOWNS[settings.cooldown ?? 3],
  }
}

const THREAD_CELL = 0.2
const THREAD_GAP = 0.27

export const CIRCUIT_SHOP: BuildTask = {
  title: 'Build it: the weekend sale.',
  sub: 'Protect the shop, then watch the sale begin. Changing anything restarts the run.',
  brief: [
    'A shop has 6 threads. Customers browse product pages, about 4 a second, and check out, about 3 a second. Each request holds a thread until it is answered.',
    'A product page asks a Reviews service for its ratings. A checkout asks Payments. Both are services you do not control, and neither behaves well all the time.',
    'You cannot see when they will fail, or how. Watch what happens, and keep the shop up through all of it. Customers give up after 3 seconds.',
    'Place pieces on the roads to the services, and choose how the shop makes its calls. Think about what each one costs, and what it cannot fix.',
  ],
  manualStart: true,
  goal: 'Keep every page loading, and turn away checkouts only while Payments is really down.',
  goalShort: 'Pages load · checkouts fail only in the outage',
  win: 'Calls give up quickly and stop altogether once a service is clearly failing. Reviews fall back to saved ratings, and checkout fails fast during the outage and recovers soon after. The pool never ran dry.',
  replies: () => true,
  holdSeconds: 4,
  testSeconds: 54,
  rps: 7,
  shot: { target: [-1.8, 0.8, 0.4], zoom: 0.62 },
  fixed: [
    { id: 'users', kind: 'users', x: USERS.x, z: USERS.z },
    { id: 'shop', kind: 'app', x: SHOP.x, z: SHOP.z },
    { id: 'pay', kind: 'app', x: DEP_AT.pay.x, z: DEP_AT.pay.z },
    { id: 'rev', kind: 'app', x: DEP_AT.rev.x, z: DEP_AT.rev.z },
  ],
  labels: [
    { at: [USERS.x, 1.6, USERS.z], text: 'Customers' },
    { at: [DEP_AT.pay.x, 1.9, DEP_AT.pay.z - 0.9], text: 'Payments' },
    { at: [DEP_AT.rev.x, 1.9, DEP_AT.rev.z + 0.9], text: 'Reviews' },
  ],
  pads: [
    { id: 'front', x: -6, z: 0, accepts: ['limiter'] },
    { id: 'extra', x: SHOP.x, z: -3.2, accepts: ['server'] },
    { id: 'b-pay', x: GATE_AT.pay.x, z: GATE_AT.pay.z, accepts: ['breaker'] },
    { id: 'b-rev', x: GATE_AT.rev.x, z: GATE_AT.rev.z, accepts: ['breaker'] },
    { id: 'c-rev', x: 0.4, z: 4.2, accepts: ['cache'] },
  ],
  toolbox: [
    { kind: 'breaker', count: 2 },
    { kind: 'cache', count: 1 },
    { kind: 'server', count: 1 },
    { kind: 'limiter', count: 1 },
  ],
  settings: [
    { id: 'timeout', label: 'timeout', when: 'app', min: 0, max: TIMEOUTS.length - 1, step: 1, initial: 5, options: TIMEOUTS.map((n) => (n === 0 ? 'No timeout' : `Give up after ${n} s`)) },
    { id: 'retries', label: 'retries', when: 'app', min: 0, max: 3, step: 1, initial: 0, options: ['No retries', '1 retry', '2 retries', '3 retries'] },
    { id: 'backoff', label: 'between tries', when: 'app', min: 0, max: 2, step: 1, initial: 0, options: ['Retry at once', 'Wait longer each time', 'Wait longer, with jitter'] },
    { id: 'pool', label: 'thread limit', when: 'app', min: 0, max: POOLS.length - 1, step: 1, initial: 0, options: POOLS.map((n) => (n === 0 ? 'No limit' : `A service holds at most ${n}`)) },
    { id: 'trip', label: 'opens after', when: 'breaker', min: 0, max: TRIPS.length - 1, step: 1, initial: 2, options: TRIPS.map((n) => `${n} failures`) },
    { id: 'cooldown', label: 'tests again after', when: 'breaker', min: 0, max: COOLDOWNS.length - 1, step: 1, initial: 3, options: COOLDOWNS.map((n) => `${n} s`) },
  ],
  watch: [
    {
      kind: 'note',
      label: 'Pages failed',
      read: (flow) => {
        const v = shopOf.get(flow)?.tally.failed.browse ?? 0
        return { text: String(v), bad: v > 0 }
      },
    },
    {
      kind: 'note',
      label: 'Checkouts failed',
      read: (flow) => {
        const t = shopOf.get(flow)?.tally
        const v = t?.failed.checkout ?? 0
        return { text: String(v), bad: (t?.needless ?? 0) > 0 }
      },
    },
    {
      kind: 'note',
      label: 'Threads busy',
      read: (flow) => {
        const s = shopOf.get(flow)
        const busy = s?.shop.active.length ?? 0
        return { text: `${busy} / ${s?.cfg.threads ?? THREADS}`, bad: !!s && busy >= s.cfg.threads }
      },
    },
  ],

  decorate(flow, placed) {
    const s = shopOf.get(flow)
    if (!s) return null
    const tick = flow.tick
    const out = []
    const threads = s.cfg.threads
    const busy = s.shop.active.length
    out.push(createElement(Tag, { key: 'shop', at: [SHOP.x, 1.9, SHOP.z], label: `Shop · ${busy} / ${threads} threads busy`, danger: busy >= threads }))
    for (const dep of ['pay', 'rev'] as const) {
      const mode = s.modeOf(dep, tick)
      out.push(createElement(Tag, { key: dep, at: [DEP_AT[dep].x, 1.9, DEP_AT[dep].z], label: `${DEP_NAMES[dep]} · ${MODE_NAMES[mode].toLowerCase()}`, danger: mode !== 'ok' }))
      if (placed[`b-${dep}`]) {
        const state = s.breakers[dep].state
        out.push(
          createElement(Tag, {
            key: `b-${dep}`,
            at: [GATE_AT[dep].x, 1.4, GATE_AT[dep].z],
            label: state === 'closed' ? 'Breaker · closed' : state === 'open' ? 'Breaker · open' : 'Breaker · testing',
            danger: state === 'open',
          }),
        )
      }
    }
    // The thread pool, a cell for each thread.
    for (let i = 0; i < threads; i++) {
      const x = SHOP.x - 0.95 + (i % 8) * THREAD_GAP
      const z = SHOP.z + 1.45 + Math.floor(i / 8) * THREAD_GAP
      const fill = i < s.stuck ? 'var(--danger)' : i < busy ? 'var(--fg)' : undefined
      out.push(createElement(IsoBox, { key: `t${i}`, x, z, w: THREAD_CELL, d: THREAD_CELL, h: 0.12, fill }))
    }
    if (placed['c-rev']) out.push(createElement(Tag, { key: 'cache', at: [0.4, 1.3, 4.2], label: 'Saved ratings' }))
    if (placed.extra) out.push(createElement(Tag, { key: 'extra', at: [SHOP.x, 1.3, -3.2], label: `+${EXTRA_THREADS} threads` }))
    return out
  },

  assemble(placed, settings) {
    const idle = [placed['c-rev'] ? 'c-rev' : '', placed.extra ? 'extra' : ''].filter(Boolean)
    const gates: Partial<Record<Dep, string>> = {}
    if (placed['b-pay']) gates.pay = 'b-pay'
    if (placed['b-rev']) gates.rev = 'b-rev'
    const s = new Shop(() => 0.5, { gates, front: placed.front ? 'front' : undefined, idle })
    const { timeout, retries, backoff, pool, trip, cooldown } = chosen(settings)
    s.configure({
      reviews: true,
      timeout,
      retries,
      backoff,
      pool,
      trip,
      cooldown,
      breaker: { pay: !!placed['b-pay'], rev: !!placed['b-rev'] },
      fallback: !!placed['c-rev'],
      threads: THREADS + (placed.extra ? EXTRA_THREADS : 0),
      script,
    })
    shopOf.set(s.flow, s)
    return s.flow
  },

  problem(_m, placed, settings, flow) {
    const s = shopOf.get(flow)
    if (!s) return null
    const t = s.tally
    const tick = flow.tick
    const { timeout, retries, backoff, pool, trip, cooldown } = chosen(settings)
    const pagesFailing = t.failed.browse > 0
    const checkoutsLost = t.needless > 0

    if (t.limited > 0) return 'The rate limiter at the door is turning away real customers. The shop is not being flooded: two services it calls are failing. A limiter at the front cannot fix that.'
    if (pagesFailing || checkoutsLost || t.turnedAway > 0) {
      if (timeout === 0) return 'With no timeout, a call to a service that has gone quiet keeps its thread for ever. Threads run out one by one. Choose how long the shop will wait.'
      if (timeout >= 4) return `The shop waits ${timeout} seconds before giving up. Customers leave after 3, and the thread is tied up all that time. Choose a shorter wait.`
      if (tick >= REV_SLOW_AT && pagesFailing && !placed['c-rev'] && !placed['b-rev'] && pool === 0) {
        return 'Reviews has gone slow, and every page waits on it, holding a thread each. Stop calling it with a breaker, or cap how many threads it can hold. And a page can do without reviews: somewhere to keep saved ratings lets it appear anyway.'
      }
      if (tick >= REV_SLOW_AT && pagesFailing && !placed['c-rev']) {
        return 'A page fails whenever its reviews do, but reviews are a nice extra, not a need. Give the pages somewhere to keep saved ratings to fall back on.'
      }
      if (tick >= REV_SLOW_AT && pagesFailing && !placed['b-rev'] && pool === 0) {
        return 'Every page still waits on slow Reviews and holds a thread for the timeout. A breaker on the road to Reviews stops the calls, or a cap on its threads keeps it from taking the pool.'
      }
      if (tick >= PAY_DOWN_AT && !placed['b-pay'] && (pagesFailing || t.turnedAway > 0)) {
        return 'Payments is down, and each checkout holds a thread while it waits and tries again. The pool runs dry and the pages fail with it. A breaker on the road to Payments makes checkouts fail at once.'
      }
      if (retries > 0 && backoff === 'none' && tick >= PAY_DOWN_AT) return 'Retrying at once sends the retry to a service that is still failing, and multiplies the traffic on it. Wait between tries, longer each time.'
      if (placed['b-pay'] && trip >= 10 && pagesFailing) return `The breaker opens only after ${trip} failures in a row. By then the threads are gone. Open it sooner.`
      if (placed.extra && pagesFailing && !placed['b-pay']) return 'More threads only delay the end. A service that never answers will use up any number of them.'
    }
    if (t.needless > 8) {
      if (pool > 0 && pool <= 2) return `The thread limit applies to every service, Payments too. Checkout needs more than ${pool} at a busy moment, so some checkouts are turned away while Payments is well. Raise the limit, or protect Reviews another way.`
      if (placed['b-pay'] && cooldown >= 6) return `Checkouts are being turned away after Payments has recovered: the breaker waits ${cooldown} seconds before it tests the road. Test sooner.`
      if (tick >= STUCK_AT && retries === 0) return 'Some calls to Payments hang, and a checkout whose call hangs is lost. The next call usually works: try again after a timeout.'
      if (tick >= STUCK_AT && timeout <= 1 && retries > 0 && timeout < 2) return 'A checkout is still lost now and then. Check that the timeout is longer than a healthy call takes.'
      return 'Checkouts are failing while Payments is answering. Check the breaker, the retries and the timeout.'
    }
    return null
  },

  check: (_m, _placed, _settings, flow) => {
    const s = flow && shopOf.get(flow)
    if (!s) return false
    const t = s.tally
    return flow.tick >= SETTLED && t.failed.browse <= 3 && t.needless <= 16 && t.limited === 0
  },
}
