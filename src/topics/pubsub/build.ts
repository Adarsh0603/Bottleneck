import { Tag } from '../../core/iso/primitives'
import { createElement } from 'react'
import type { BuildTask, Placement } from '../../core/build/types'
import type { FlowSim } from '../../core/flow/engine'
import { Bus, MAX_CONSUMERS, TEAM_NAMES, TEAMS, TICKS_PER_SECOND, type KeyBy, type Mode, type Team } from './bus'
import { CHANNEL, CONSUMER_Z, ORDERS, PRODUCT_FILL, TEAM_X, consumerKey } from './world'

// Build it: the order desk. Orders arrive at 5 a second and three teams each
// need every one of them. The learner picks the channel and sets it up:
//   - A queue gives each order to ONE consumer, so each team misses most.
//   - A topic copies every order to every team, but Analytics goes offline for
//     12 seconds, and what a topic sends while a team is away is gone. Email
//     and Inventory also lose orders if their consumers are too few to take
//     them as they come.
//   - A stream keeps the orders in a log, so Analytics catches up. But the log
//     only keeps them for a while (shorter than the outage, to start with),
//     and its partitions decide who can work in parallel and in what order:
//       Email and Inventory each need 3 consumers to keep up, and a partition
//       is read by one consumer at a time, so they need 3 partitions that
//       actually get orders. Inventory also needs each product's orders in
//       order, so the key must be the product. A 4th partition, or a 4th
//       consumer, does nothing.
// There are 7 consumers to hand out: 3 for Email, 3 for Inventory, and a
// spare that is a decoy.

const RPS = 5
const OUTAGE = { start: 10 * TICKS_PER_SECOND, length: 12 * TICKS_PER_SECOND }
const SLACK = 6 // events a team may be behind and still count as caught up
const KEYS: KeyBy[] = ['none', 'order', 'product']
const KEY_PRODUCT = 2
export const RETENTION = [5, 30, 120] // seconds

const emailPads = Array.from({ length: MAX_CONSUMERS.email }, (_, i) => consumerKey('email', i))
const stockPads = Array.from({ length: MAX_CONSUMERS.stock }, (_, i) => consumerKey('stock', i))

export const busOf = new WeakMap<FlowSim, Bus>()

const padsOf = (placed: Placement, pads: string[]) => pads.filter((id) => placed[id]).length
const sum = (r: Record<Team, number>) => TEAMS.reduce((n, t) => n + r[t], 0)

const channelLabel = (mode: Mode, bus: Bus, settings: Record<string, number>) =>
  mode === 'queue'
    ? `Queue · ${bus.channel?.jobs.length ?? 0} waiting`
    : mode === 'topic'
      ? 'Topic · copies to all'
      : `Stream · ${bus.log.partitions} partition${bus.log.partitions === 1 ? '' : 's'} · ${['no key', 'key: order id', 'key: product'][settings.key ?? 0]} · keep ${RETENTION[settings.retention ?? 0]}s`

export const ORDER_DESK: BuildTask = {
  title: 'Build it: the order desk.',
  sub: 'Place a channel and some consumers, then watch the orders roll in. Changing anything restarts the run.',
  brief: [
    'Orders arrive at 5 a second. Three teams each need every single one: Email sends receipts, Analytics counts sales, and Inventory updates stock.',
    'Email and Inventory are slow. A consumer finishes about 2 orders a second, and you have 7 consumers to hand out.',
    'Ten seconds in, Analytics goes offline for 12 seconds while it is redeployed. Orders keep coming.',
    'Inventory must handle the orders for one product in the order they were placed, or its stock count goes wrong. The dark, grey and white cubes are the three products.',
    'Pick the channel in the middle, then set it up. A queue, a topic and a stream each behave differently. Think about what each team needs.',
  ],
  manualStart: true,
  goal: 'Every team gets every order, Inventory in order, even through the outage.',
  goalShort: 'Every order · in order · through the outage',
  win: 'A stream kept the orders while Analytics was away. Keyed by product across three partitions, Inventory stayed in order, and each team had a consumer for every partition it needed.',
  holdSeconds: 4,
  rps: RPS,
  shot: { target: [-1.6, 0.8, 0], zoom: 0.46 },
  fixed: [
    { id: 'orders', kind: 'app', x: ORDERS.x, z: ORDERS.z },
    { id: 'stats-0', kind: 'server', x: TEAM_X, z: CONSUMER_Z.stats[0] },
  ],
  pads: [
    { id: 'channel', x: CHANNEL.x, z: CHANNEL.z, accepts: ['queue', 'topic', 'stream'] },
    ...emailPads.map((id, i) => ({ id, x: TEAM_X, z: CONSUMER_Z.email[i], accepts: ['server' as const] })),
    ...stockPads.map((id, i) => ({ id, x: TEAM_X, z: CONSUMER_Z.stock[i], accepts: ['server' as const] })),
  ],
  toolbox: [
    { kind: 'queue', count: 1 },
    { kind: 'topic', count: 1 },
    { kind: 'stream', count: 1 },
    { kind: 'server', count: 7 },
  ],
  settings: [
    { id: 'partitions', label: 'partition', when: 'stream', min: 1, max: 4, step: 1, initial: 1 },
    { id: 'key', label: 'Key', when: 'stream', min: 0, max: 2, step: 1, initial: 0, options: ['No key', 'Order id', 'Product'] },
    { id: 'retention', label: 'Keep', when: 'stream', min: 0, max: 2, step: 1, initial: 0, options: ['5 s', '30 s', '2 min'] },
  ],
  watch: [
    {
      kind: 'note',
      label: 'Orders missed',
      read: (flow) => {
        const t = busOf.get(flow)?.tally
        const n = t ? sum(t.lost) : 0
        return { text: String(n), bad: n > 0 }
      },
    },
    {
      kind: 'note',
      label: 'Behind',
      read: (flow) => {
        const bus = busOf.get(flow)
        const n = bus ? Math.max(...TEAMS.map((t) => bus.behind(t))) : 0
        return { text: String(n), bad: n >= SLACK }
      },
    },
    {
      kind: 'note',
      label: 'Out of order',
      read: (flow) => {
        const n = busOf.get(flow)?.tally.disorder ?? 0
        return { text: String(n), bad: n > 0 }
      },
    },
    {
      kind: 'note',
      label: 'Analytics',
      read: (flow) => {
        const down = busOf.get(flow)?.consumers.some((c) => c.team === 'stats' && !c.alive) ?? false
        return { text: down ? 'offline' : 'online', bad: down }
      },
    },
  ],
  jobFill: (job) => PRODUCT_FILL[job.key ?? 0],

  // Live tags that follow the numbers: what the channel is doing, and how each
  // team is getting on.
  decorate(flow, placed, settings) {
    const bus = busOf.get(flow)
    if (!bus) return null
    const mode = placed.channel as Mode | undefined
    const tags = [createElement(Tag, { key: 'orders', at: [ORDERS.x, 1.9, ORDERS.z], label: `Orders · ${RPS}/s` })]
    tags.push(
      mode
        ? createElement(Tag, { key: 'channel', at: [CHANNEL.x, 1.6, CHANNEL.z], label: channelLabel(mode, bus, settings), danger: mode === 'queue' && (bus.channel?.jobs.length ?? 0) >= 40 })
        : createElement(Tag, { key: 'channel', at: [CHANNEL.x, 0.4, CHANNEL.z], label: 'Pick a channel', danger: true }),
    )
    const at: Record<Team, [number, number, number]> = {
      email: [TEAM_X, 0.3, CONSUMER_Z.email[MAX_CONSUMERS.email - 1] - 1.5],
      stats: [TEAM_X + 2, 0.3, CONSUMER_Z.stats[0]],
      stock: [TEAM_X, 0.3, CONSUMER_Z.stock[MAX_CONSUMERS.stock - 1] + 1.5],
    }
    for (const team of TEAMS) {
      const mine = bus.consumers.filter((c) => c.team === team)
      const down = team === 'stats' && mine.some((c) => !c.alive)
      const behind = bus.behind(team)
      const lost = bus.tally.lost[team]
      let label = `${TEAM_NAMES[team]} · ${mine.length} consumer${mine.length === 1 ? '' : 's'}`
      if (down) label += ' · offline'
      if (mode && behind > 0) label += ` · ${behind} behind`
      if (lost > 0) label += ` · ${lost} missed`
      if (team === 'stock' && bus.tally.disorder > 0) label += ' · out of order'
      tags.push(createElement(Tag, { key: team, at: at[team], label, danger: down || lost > 0 || behind >= SLACK || (team === 'stock' && bus.tally.disorder > 0) }))
    }
    return tags
  },

  assemble(placed, settings, rng) {
    const keys = [...emailPads, ...stockPads].filter((id) => placed[id])
    const bus = new Bus(rng, { keys: [...keys, 'stats-0'], channel: !!placed.channel })
    bus.configure({
      rps: RPS,
      mode: (placed.channel as Mode | undefined) ?? 'topic',
      partitions: settings.partitions ?? 1,
      key: KEYS[settings.key ?? 0],
      retention: RETENTION[settings.retention ?? 0],
      outage: OUTAGE,
    })
    busOf.set(bus.flow, bus)
    return bus.flow
  },

  problem(_m, placed, settings, flow) {
    const bus = busOf.get(flow)
    if (!bus) return null
    const t = bus.tally
    const mode = placed.channel as Mode | undefined
    if (!mode) return 'The orders have nowhere to go. Put a queue, a topic or a stream on the pad in the middle.'
    const email = padsOf(placed, emailPads)
    const stock = padsOf(placed, stockPads)
    if (email === 0) return 'Email has no consumers, so it hears about nothing. Place servers on the Email pads.'
    if (stock === 0) return 'Inventory has no consumers, so it hears about nothing. Place servers on the Inventory pads.'

    if (mode === 'queue' && sum(t.lost) > 0) {
      return 'A queue hands each order to ONE consumer, so the teams share the orders between them and each one misses most of them. Every team has to see every order.'
    }
    if (mode === 'topic') {
      if (t.lost.stats > 0) return 'Analytics went offline, and a topic does not remember. Orders sent while it was away are gone for good. Something has to keep them for later.'
      if (t.lost.email > 0 || t.lost.stock > 0) return 'A topic hands an order over right away. A consumer that cannot take it then misses it. Something has to hold orders for a team that is slow.'
    }
    if (mode === 'stream') {
      const short = settings.retention === 0
      if (sum(t.lost) > 0 && short) return 'The log forgot some orders before a team came to read them. It keeps them only 5 seconds, and Analytics was away for 12. Keep them longer.'
      if (t.lost.email > 0 || t.lost.stock > 0) return 'A team fell so far behind that the log forgot orders before it read them. Give it more consumers to catch up.'
      if (t.disorder > 0) return 'Inventory handled an order after a later one for the same product. Orders for one product landed in different partitions, and different consumers finished them out of order. Choose a key that keeps one product in one partition.'
      const lanes = settings.key === KEY_PRODUCT ? Math.min(bus.log.partitions, 3) : bus.log.partitions
      const stuck = (team: Team, n: number) => {
        if (bus.behind(team) < 10) return null
        if (n > lanes) return `${TEAM_NAMES[team]} has ${n} consumers, but only ${lanes} partition${lanes === 1 ? '' : 's'} get orders. A partition is read by one consumer at a time, so the extra consumers sit idle.`
        return `${TEAM_NAMES[team]} is falling behind. A consumer handles about 2 orders a second, and each works on a partition of its own. Give it more consumers, and enough partitions for them.`
      }
      const slow = stuck('stock', stock) ?? stuck('email', email)
      if (slow) return slow
      if (stock > 1 && settings.key !== KEY_PRODUCT) return 'Orders for one product could still reach Inventory out of order. Make the product the key, so one product always lands in one partition.'
    }
    return null
  },

  check: (_m, placed, settings, flow) => {
    const bus = flow && busOf.get(flow)
    if (!bus || placed.channel !== 'stream' || settings.key !== KEY_PRODUCT) return false
    const t = bus.tally
    return t.outages >= 1 && sum(t.lost) === 0 && t.disorder === 0 && TEAMS.every((team) => bus.behind(team) < SLACK)
  },
}
