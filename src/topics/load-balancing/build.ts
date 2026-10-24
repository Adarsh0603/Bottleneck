import { TICKS_PER_SECOND } from '../../core/build/run'
import type { BuildTask } from '../../core/build/types'
import { FlowSim, type FlowNode } from '../../core/flow/engine'
import { Router, Source, Worker } from '../../core/flow/nodes'

// Build it: Black Friday, users send 9 req/s. One pad in front, five behind.
//   - A server in front takes everything alone; the back pads never see
//     traffic (users only know one address).
//   - A load balancer in front spreads requests across the back servers.
// Each new server handles about 3.2 req/s, but the middle pad holds an old
// one that manages only 70% of that. Twelve seconds in, a server crashes.
//   - Four new servers can't survive the crash: the old one has to work too.
//   - Round robin hands the old server as much as the rest, so it drowns.
//     Least connections gives slow servers fewer requests.

const RPS = 9
const BACK_Z = [-3.6, -1.8, 0, 1.8, 3.6]
const TRIP_TICKS = 8
const OLD_PAD = 2
const OLD_SPEED = 0.7
export const CRASH_TICK = 12 * TICKS_PER_SECOND
const ALGORITHMS = ['round-robin', 'random', 'least-connections'] as const

// Kills one server at a set time.
class Crash implements FlowNode {
  alive = true
  readonly key = 'crash'
  private strike: () => void

  constructor(strike: () => void) {
    this.strike = strike
  }

  receive() {}

  process(sim: FlowSim) {
    if (sim.tick === CRASH_TICK) this.strike()
  }
}

export const BLACK_FRIDAY: BuildTask = {
  title: 'Build it: the Black Friday rush.',
  sub: 'Drag pieces from the toolbox onto the pads.',
  brief: [
    'It’s Black Friday. Shoppers send 9 requests a second, and a single server can only answer about 3.',
    'You have a load balancer and six servers. There are five spots behind it, and the middle one holds an old machine that is 30% slower than the rest.',
    'Twelve seconds in, one of the new servers crashes. Whatever is left has to carry the whole load.',
    'Your job: keep errors under 1% and every server under 90% busy, even after the crash. The load balancer has a setting for how it picks a server: try them.',
  ],
  manualStart: true,
  goal: 'Survive the crash: under 1% errors and no server over 90% busy.',
  win: 'A load balancer in front, every server used, and a smart way of picking so the old one gets less.',
  holdSeconds: 6,
  testSeconds: 22,
  rps: RPS,
  shot: { target: [-1.2, 0.6, 0], zoom: 0.9 },
  fixed: [{ id: 'users', kind: 'users', x: -6.5, z: 0 }],
  labels: [{ at: [2.6, 1.7, BACK_Z[OLD_PAD] + 1], text: 'Old machine' }],
  pads: [
    { id: 'front', x: -2.2, z: 0, accepts: ['balancer', 'server'] },
    ...BACK_Z.map((z, i) => ({ id: `back-${i}`, x: 2.6, z, accepts: ['server' as const] })),
  ],
  toolbox: [
    { kind: 'balancer', count: 1 },
    { kind: 'server', count: 6 },
  ],
  settings: [{ id: 'algo', label: 'picks by', when: 'balancer', min: 0, max: 2, step: 1, initial: 0, options: ['Round robin', 'Random', 'Least connections'] }],

  assemble(placed, settings, rng) {
    const flow = new FlowSim(rng)
    const users = flow.add(new Source('users'))
    users.rate = RPS / TICKS_PER_SECOND

    const front = placed.front
    if (front === 'balancer') flow.add(new Router('front')).algorithm = ALGORITHMS[settings.algo ?? 0]
    if (front === 'server') flow.add(new Worker('front'))
    if (front) flow.link('users', 'front', TRIP_TICKS)

    const alive: string[] = []
    BACK_Z.forEach((_, i) => {
      const id = `back-${i}`
      if (placed[id] !== 'server') return
      flow.add(new Worker(id, { speed: i === OLD_PAD ? OLD_SPEED : 1 }))
      alive.push(id)
      if (front === 'balancer') flow.link('front', id, TRIP_TICKS)
    })

    // The first new server goes down.
    const doomed = alive.find((id) => id !== `back-${OLD_PAD}`) ?? alive[0]
    if (doomed) {
      flow.add(
        new Crash(() => {
          flow.node(doomed)!.alive = false
          flow.fail(doomed)
        }),
      )
    }
    return flow
  },

  problem: (m, placed, settings, flow) => {
    if (placed.front === 'server') return 'Users only know one address: the front server. The ones behind it never see a request.'
    if (placed.front !== 'balancer') return null
    const old = flow.node(`back-${OLD_PAD}`)
    if (old instanceof Worker && old.queue.length >= old.queueLimit - 1 && settings.algo !== 2) {
      return 'The old machine gets as many requests as the new ones, but it is slower. Its line is full.'
    }
    if (m.dropRate > 1 && flow.tick > CRASH_TICK) return 'After the crash there is not enough capacity left. Every server has to be used.'
    return null
  },

  // Served after the crash, with no errors and nobody running flat out (an
  // overloaded system can look fine for a few seconds before its queues fill).
  check: (m, placed, _settings, flow) =>
    placed.front === 'balancer' && !!flow && flow.tick > CRASH_TICK + 4 * TICKS_PER_SECOND && m.dropRate < 1 && m.busiest < 0.9,
}
