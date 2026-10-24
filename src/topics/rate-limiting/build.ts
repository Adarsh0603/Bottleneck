import { createElement } from 'react'
import { Tag } from '../../core/iso/primitives'
import type { BuildTask, Placement } from '../../core/build/types'
import type { FlowSim } from '../../core/flow/engine'
import { ALGO_NAMES, BURSTS, Gateway, LIMITS, TICKS_PER_SECOND, type Algo, type BotMode, type Scope } from './gate'
import { API, BALANCER, CLIENT_X, CLIENT_Z, COUNTER, GATE_X, gateZ } from './world'

// Build it: the partner API. A and B are real customers; the bot is not.
// The learner builds the front door out of a balancer, up to three gateways
// (each with its own rate limiter) and an optional shared counter, and picks
// how the limiter decides. Nothing is said about when the trouble starts:
//   - for the first 5 seconds all is calm
//   - then the bot sends bursts timed to straddle the clock second, which a
//     fixed window lets through at twice the limit
//   - after 15 seconds it floods, 15 requests a second
//   - all the while A's app loads a page every 5 seconds: 4 requests at once
// A gateway can only decide about 12 requests a second, and the traffic is
// more than that in all, so one gateway is not enough. The gateways that run
// are only used if a balancer sends them traffic, and each counts alone unless
// there is a shared counter. The API serves 10 a second.
//
// Settings: the algorithm, the limit, the bucket size, and whether the limit
// is for everyone or for each client.

const ALGOS: Algo[] = ['fixed', 'sliding', 'token', 'leaky']
const SCOPES: Scope[] = ['all', 'client']
const GATE_CAPACITY = 12 // decisions a second one gateway can make
const API_QUEUE = 6
const ANN_BURST = 4
const CALM = 5 * TICKS_PER_SECOND
const FLOOD_AT = 15 * TICKS_PER_SECOND
const SETTLED = 25 * TICKS_PER_SECOND // a flood has been going long enough to judge

const script = (tick: number): BotMode => (tick < CALM ? 'quiet' : tick < FLOOD_AT ? 'edge' : 'flood')

export const gatewayOf = new WeakMap<FlowSim, Gateway>()

const gatePads = [0, 1, 2].map((i) => `gate-${i}`)
const placedGates = (placed: Placement) => gatePads.filter((id) => placed[id]).length

// What the learner has chosen.
export function chosen(settings: Record<string, number>) {
  return {
    algo: ALGOS[settings.algo ?? 0],
    limit: LIMITS[settings.limit ?? 2],
    burst: BURSTS[settings.burst ?? 1],
    scope: SCOPES[settings.scope ?? 0],
  }
}

export const API_GATEWAY: BuildTask = {
  title: 'Build it: the partner API.',
  sub: 'Build the front door, then watch the traffic arrive. Changing anything restarts the run.',
  brief: [
    'A partner API serves about 10 requests a second. A and B are real customers, and each sends a couple of requests a second.',
    'A’s app loads a page every few seconds: 4 requests at once, then quiet. That is honest traffic, and it must never be turned away.',
    'The bot is the problem, and it does not behave the same all the time. Watch what it does, and keep the API healthy through all of it.',
    'One gateway can only decide about 12 requests a second, and more than that is coming. Gateways only get traffic from a balancer, and each one keeps its own count unless they share a counter.',
    'Place the pieces, then choose how the limiter decides. Each algorithm has a weakness. Think about what the bot, and A, will do to it.',
  ],
  manualStart: true,
  goal: 'Keep the API alive, turn the bot away, and never turn A or B away.',
  goalShort: 'API safe · bot held back · A and B served',
  win: 'The gateways shared the load, the limiter counted each client on its own, and the setting you chose held up through the bursts and the flood. A’s page loads went through and the API never ran out of room.',
  holdSeconds: 4,
  rps: 6,
  shot: { target: [-1.6, 0.8, -0.6], zoom: 0.68 },
  fixed: [
    ...(['ann', 'bo', 'bot'] as const).map((id) => ({ id, kind: 'users' as const, x: CLIENT_X, z: CLIENT_Z[id] })),
    { id: 'api', kind: 'app', x: API.x, z: API.z },
  ],
  labels: [
    { at: [CLIENT_X, 1.6, CLIENT_Z.ann], text: 'A' },
    { at: [CLIENT_X, 1.6, CLIENT_Z.bo], text: 'B' },
    { at: [CLIENT_X, 1.6, CLIENT_Z.bot], text: 'Bot' },
  ],
  pads: [
    { id: 'lb', x: BALANCER.x, z: BALANCER.z, accepts: ['balancer'] },
    ...gatePads.map((id, i) => ({ id, x: GATE_X, z: gateZ(i, 3), accepts: ['limiter' as const] })),
    { id: 'counter', x: COUNTER.x, z: COUNTER.z, accepts: ['cache'] },
  ],
  toolbox: [
    { kind: 'balancer', count: 1 },
    { kind: 'limiter', count: 3 },
    { kind: 'cache', count: 1 },
  ],
  settings: [
    { id: 'algo', label: 'algorithm', when: 'limiter', min: 0, max: 3, step: 1, initial: 0, options: ['Fixed window', 'Sliding window', 'Token bucket', 'Leaky bucket'] },
    { id: 'limit', label: 'limit', when: 'limiter', min: 0, max: LIMITS.length - 1, step: 1, initial: 2, options: LIMITS.map((n) => `${n} / second`) },
    { id: 'burst', label: 'bucket', when: 'limiter', min: 0, max: BURSTS.length - 1, step: 1, initial: 1, options: BURSTS.map((n) => `Bucket of ${n}`) },
    { id: 'scope', label: 'count', when: 'limiter', min: 0, max: 1, step: 1, initial: 0, options: ['For everyone', 'For each client'] },
  ],
  watch: [
    {
      kind: 'note',
      label: 'A turned away',
      read: (flow) => {
        const n = gatewayOf.get(flow)
        const v = n ? n.tally.rejected.ann + n.tally.busy.ann : 0
        return { text: String(v), bad: v > 0 }
      },
    },
    {
      kind: 'note',
      label: 'API overloaded',
      read: (flow) => {
        const v = gatewayOf.get(flow)?.tally.overload ?? 0
        return { text: String(v), bad: v > 0 }
      },
    },
    {
      kind: 'note',
      label: 'Bot allowed',
      read: (flow) => ({ text: `${(gatewayOf.get(flow)?.rateOf('bot') ?? 0).toFixed(1)} /s`, bad: false }),
    },
    {
      kind: 'note',
      label: 'The bot is',
      read: (flow) => {
        const t = flow.tick
        return { text: t < CALM ? 'quiet' : t < FLOOD_AT ? 'sending bursts' : 'flooding', bad: t >= FLOOD_AT }
      },
    },
  ],

  decorate(flow, placed, settings) {
    const g = gatewayOf.get(flow)
    if (!g) return null
    const { algo, limit, burst } = chosen(settings)
    const tags = [createElement(Tag, { key: 'api', at: [API.x, 1.9, API.z], label: `API · 10 / second${g.tally.overload > 0 ? ` · ${g.tally.overload} dropped` : ''}`, danger: g.recentOverload > 0 })]
    gatePads.forEach((id, i) => {
      if (!placed[id]) return
      const bucket = algo === 'token' || algo === 'leaky' ? ` · bucket of ${burst}` : ''
      const busy = g.tally.busy.ann + g.tally.busy.bo + g.tally.busy.bot
      tags.push(createElement(Tag, { key: id, at: [GATE_X, 1.5, gateZ(i, 3)], label: `Algorithm: ${ALGO_NAMES[algo]} · ${limit} / second${bucket}`, danger: busy > 0 }))
    })
    return tags
  },

  assemble(placed, settings) {
    const gates = gatePads.filter((id) => placed[id])
    const g = new Gateway(() => 0.5, { gates, balancer: !!placed.lb })
    const { algo, limit, burst, scope } = chosen(settings)
    g.configure({
      limiting: true,
      algo,
      limit,
      burst,
      scope,
      annBursts: true,
      bot: 'quiet',
      script,
      apiQueue: API_QUEUE,
      capacity: GATE_CAPACITY,
      shared: !!placed.counter,
    })
    gatewayOf.set(g.flow, g)
    return g.flow
  },

  problem(_m, placed, settings, flow) {
    const g = gatewayOf.get(flow)
    if (!g) return null
    const t = g.tally
    const gates = placedGates(placed)
    const { algo, limit, burst, scope } = chosen(settings)
    const annHit = t.rejected.ann + t.busy.ann
    const boHit = t.rejected.bo + t.busy.bo
    const busy = t.busy.ann + t.busy.bo + t.busy.bot

    if (gates === 0) return t.overload > 0 ? 'Nothing is checking the requests, so the bot goes straight to the API and drowns it. Put a rate limiter on a gateway pad.' : null
    if (busy > 0 && gates === 1) return 'One gateway cannot decide fast enough for all this traffic (about 12 requests a second), so it turns real customers away. Add more gateways, with a balancer in front to share the traffic.'
    if (gates > 1 && !placed.lb && t.overload + annHit + busy > 0) return 'Clients only talk to the first gateway. The others sit idle until a balancer sends them traffic.'
    if (annHit + boHit > 0) {
      if (scope === 'all') return 'One count for everyone: the bot uses up the whole allowance and real customers are turned away. Count each client on its own.'
      if (algo === 'token' || algo === 'leaky') {
        if (burst < ANN_BURST) return `A’s page load sends ${ANN_BURST} requests at once, but the bucket holds only ${burst}. The rest are turned away. A bucket has to be big enough for an honest burst.`
      } else if (limit <= ANN_BURST) {
        return `A’s page load sends ${ANN_BURST} requests at once, and a ${limit} a second limit turns some of them away. A window has no give for a burst. Raise the limit, or use a bucket that allows one.`
      }
      if (gates > 1 && !placed.counter) return 'With a counter in each gateway, A’s burst is split and each gateway sees only part of it, but a limit this low also bites its ordinary requests. Check the limit against what an honest customer sends.'
      return 'A real customer was turned away. Check that the limit is not lower than what an honest customer sends.'
    }
    if (t.overload > 0) {
      if (algo === 'fixed' && g.flow.tick >= CALM) return 'The bot sends a burst just before the clock second ends and another just after. A fixed window counts each second separately, so both bursts pass, double the limit, all at once. The API has no room for that.'
      if (gates > 1 && !placed.counter) return `Each gateway counts alone. With ${gates} gateways the bot gets ${gates} times the limit through, and the API cannot serve that. Share one counter, or lower the limit.`
      if (algo === 'token' && burst > 6) return 'The bucket is so big that a large burst gets through at once. The API only has room for a few requests to wait.'
      return `The limit lets through more than the API can serve. It handles 10 a second in all, and A and B use some of that. A limit of ${limit} for the bot is too much.`
    }
    return null
  },

  check: (_m, placed, _settings, flow) => {
    const g = flow && gatewayOf.get(flow)
    if (!g || placedGates(placed) === 0) return false
    const t = g.tally
    return g.flow.tick >= SETTLED && t.overload === 0 && t.rejected.ann + t.busy.ann === 0 && t.rejected.bo + t.busy.bo === 0 && t.rejected.bot > 0 && g.rateOf('bot') <= 6
  },
}
