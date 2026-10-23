import type { BuildTask } from '../../core/build/types'
import { Cache } from '../../core/flow/cache'
import { FlowSim } from '../../core/flow/engine'
import { Source, Worker } from '../../core/flow/nodes'
import { pick, zipfTable } from '../../core/flow/popularity'
import { edgeKey, edgeSpot, ORIGIN, REGIONS, regionOf, TICKS_PER_SECOND, travelTicks, usersKey } from './world'

// Build it: users in three regions, one origin. A pad near each region.
//   - Nothing on a pad: those users go all the way to the origin.
//   - A server there (the decoy): it only adds a hop.
//   - A cache there: an edge. Popular files are answered next door.
// Getting everyone under half a second takes an edge in every region.

const RPS = 4
const LIMIT_MS = 500
const POPULAR = zipfTable(40)

export const GO_GLOBAL: BuildTask = {
  title: 'Build it: go global.',
  sub: 'Drag edge caches near your users.',
  goal: `Get every region under ${LIMIT_MS / 1000}s.`,
  win: 'An edge near every group of users.',
  holdSeconds: 5,
  rps: RPS * REGIONS.length,
  shot: { target: [-0.9, 0.6, -0.2], zoom: 0.8 },
  fixed: [
    { id: 'origin', kind: 'server', x: ORIGIN.x, z: ORIGIN.z },
    ...REGIONS.map((r) => ({ id: usersKey(r.id), kind: 'users' as const, x: r.x, z: r.z })),
  ],
  pads: REGIONS.map((r) => ({ id: edgeKey(r.id), ...edgeSpot(r.id), accepts: ['cache' as const, 'server' as const] })),
  toolbox: [
    { kind: 'cache', count: 3 },
    { kind: 'server', count: 1 },
  ],
  watch: REGIONS.map((r) => ({ kind: 'latency' as const, key: usersKey(r.id), label: r.name, limitMs: LIMIT_MS })),

  assemble(placed, _settings, rng) {
    const flow = new FlowSim(rng)
    const origin = flow.add(new Worker('origin', { slots: 8, queueLimit: 32, workPerRequest: 4 }))
    const edges = new Map<string, Cache>()
    for (const r of REGIONS) {
      const users = flow.add(new Source(usersKey(r.id)))
      users.rate = RPS / TICKS_PER_SECOND
      users.keyOf = (rand) => pick(POPULAR, rand())
      const pad = edgeKey(r.id)
      const spot = edgeSpot(r.id)
      if (placed[pad] === 'cache') {
        const edge = flow.add(new Cache(pad))
        edge.capacity = 20
        edges.set(r.id, edge)
      }
      if (placed[pad] === 'server') flow.add(new Worker(pad, { slots: 8, queueLimit: 16, workPerRequest: 2 }))
      if (placed[pad]) {
        flow.link(usersKey(r.id), pad, travelTicks(r, spot))
        flow.link(pad, 'origin', travelTicks(spot, ORIGIN))
      } else {
        flow.link(usersKey(r.id), 'origin', travelTicks(r, ORIGIN))
      }
    }
    origin.onFinish = (job, sim) => {
      const region = regionOf(job.from)
      const edge = region && edges.get(region)
      if (edge && job.key !== undefined) edge.fill(job.key, sim)
    }
    return flow
  },

  check: (m) => REGIONS.every((r) => (m.latency[usersKey(r.id)] ?? Infinity) < LIMIT_MS),
}
