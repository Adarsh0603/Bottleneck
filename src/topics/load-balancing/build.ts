import { TICKS_PER_SECOND } from '../../core/build/run'
import type { BuildTask } from '../../core/build/types'
import { FlowSim } from '../../core/flow/engine'
import { Router, Source, Worker } from '../../core/flow/nodes'

// Build it: Black Friday, users send 10 req/s. One pad in front, five behind.
//   - A server in front takes everything alone; the back pads never see
//     traffic (users only know one address).
//   - A load balancer in front spreads requests across the back servers.
// Each server handles about 3.2 req/s, so it takes 4 behind a balancer.

const RPS = 10
const BACK_Z = [-3.6, -1.8, 0, 1.8, 3.6]
const TRIP_TICKS = 8

export const BLACK_FRIDAY: BuildTask = {
  title: 'Build it: the Black Friday rush.',
  sub: 'Drag pieces from the toolbox onto the pads.',
  goal: 'Handle 10 req/s with under 1% errors.',
  win: 'A load balancer in front, enough servers behind it.',
  holdSeconds: 6,
  rps: RPS,
  shot: { target: [-1.2, 0.6, 0], zoom: 0.9 },
  fixed: [{ id: 'users', kind: 'users', x: -6.5, z: 0 }],
  pads: [
    { id: 'front', x: -2.2, z: 0, accepts: ['balancer', 'server'] },
    ...BACK_Z.map((z, i) => ({ id: `back-${i}`, x: 2.6, z, accepts: ['server' as const] })),
  ],
  toolbox: [
    { kind: 'balancer', count: 1 },
    { kind: 'server', count: 6 },
  ],

  assemble(placed, _settings, rng) {
    const flow = new FlowSim(rng)
    const users = flow.add(new Source('users'))
    users.rate = RPS / TICKS_PER_SECOND

    const front = placed.front
    if (front === 'balancer') flow.add(new Router('front'))
    if (front === 'server') flow.add(new Worker('front'))
    if (front) flow.link('users', 'front', TRIP_TICKS)

    BACK_Z.forEach((_, i) => {
      const id = `back-${i}`
      if (placed[id] !== 'server') return
      flow.add(new Worker(id))
      if (front === 'balancer') flow.link('front', id, TRIP_TICKS)
    })
    return flow
  },

  // No errors, and no server running flat out (an overloaded system can look
  // fine for a few seconds before its queues fill).
  check: (m) => m.dropRate < 1 && m.busiest < 0.9,
}
