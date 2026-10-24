import type { BuildTask } from '../../core/build/types'
import type { V3 } from '../../core/types'
import { Cache } from '../../core/flow/cache'
import { FlowSim } from '../../core/flow/engine'
import { Source, Worker } from '../../core/flow/nodes'
import { pick, zipfTable } from '../../core/flow/popularity'
import { edgeKey, edgeSpot, ORIGIN, REGIONS, regionOf, TICKS_PER_SECOND, travelTicks, usersKey, type RegionId } from './world'

// Build it: users in three regions, one origin. A pad near each region, but
// only two edge caches to place.
//   - Nothing on a pad: those users go all the way to the origin.
//   - A server there (the decoy): it only adds a hop.
//   - A cache there: an edge. Popular files are answered next door.
// Europe's pages are different for every visitor, so an edge there almost
// never has what the next visitor wants. The two edges belong in the US and
// Asia, where everyone asks for the same popular files. The brief doesn't say
// so: the learner finds out from the numbers, and from problem().

const RPS = 4
const LIMIT_MS = 500
const POPULAR = zipfTable(40)
const PERSONAL = 2000 // distinct pages Europe's visitors ask for
const PERSONAL_REGION: RegionId = 'eu'
const GOALS = REGIONS.filter((r) => r.id !== PERSONAL_REGION)

export const GO_GLOBAL: BuildTask = {
  title: 'Build it: go global.',
  sub: 'You only have two edge caches. Choose where they help.',
  brief: [
    'Your site has visitors in the US, Europe and Asia, and everything is served from one origin server. The farther away a visitor is, the longer every request takes.',
    'An edge cache stores popular files close to the visitors who ask for them. You only have two to place.',
    'Visitors in different places do not always ask for the same things. Place the edges where you think they will help, then watch the numbers for each region.',
  ],
  manualStart: true,
  goal: `Get every region you can under ${LIMIT_MS / 1000}s with two edge caches.`,
  goalShort: `Regions under ${LIMIT_MS / 1000}s.`,
  win: 'Edges in the US and Asia, where visitors share popular files. Europe’s visitors each get a personal page, so an edge there has nothing to reuse and Europe stays slow.',
  holdSeconds: 5,
  rps: RPS * REGIONS.length,
  shot: { target: [-0.9, 0.6, -0.2], zoom: 0.8 },
  fixed: [
    { id: 'origin', kind: 'server', x: ORIGIN.x, z: ORIGIN.z },
    ...REGIONS.map((r) => ({ id: usersKey(r.id), kind: 'users' as const, x: r.x, z: r.z })),
  ],
  pads: REGIONS.map((r) => ({ id: edgeKey(r.id), ...edgeSpot(r.id), accepts: ['cache' as const, 'server' as const] })),
  toolbox: [
    { kind: 'cache', count: 2 },
    { kind: 'server', count: 1 },
  ],
  labels: [
    ...REGIONS.map((r) => ({ at: [r.x, 1.6, r.z] as V3, text: r.name })),
    { at: [ORIGIN.x, 1.6, ORIGIN.z], text: 'Origin' },
  ],
  watch: REGIONS.map((r) => ({ kind: 'latency' as const, key: usersKey(r.id), label: r.name, limitMs: LIMIT_MS })),

  assemble(placed, _settings, rng) {
    const flow = new FlowSim(rng)
    const origin = flow.add(new Worker('origin', { slots: 8, queueLimit: 32, workPerRequest: 4 }))
    const edges = new Map<string, Cache>()
    for (const r of REGIONS) {
      const users = flow.add(new Source(usersKey(r.id)))
      users.rate = RPS / TICKS_PER_SECOND
      users.keyOf = r.id === PERSONAL_REGION ? (rand) => 100 + Math.floor(rand() * PERSONAL) : (rand) => pick(POPULAR, rand())
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

  problem(_m, placed, _settings, flow) {
    if (flow.tick < 8 * TICKS_PER_SECOND) return null
    const eu = flow.node(edgeKey(PERSONAL_REGION))
    if (eu instanceof Cache && eu.hits + eu.misses >= 30 && eu.hits / (eu.hits + eu.misses) < 0.15) {
      return 'The edge in Europe almost never has what the next visitor asks for: every visitor there wants a different page, so there is nothing to reuse.'
    }
    if (Object.values(placed).includes('server')) return 'A plain server stores nothing. Visitors still wait for the origin, and the extra stop only adds a hop.'
    return null
  },

  check: (m) => GOALS.every((r) => (m.latency[usersKey(r.id)] ?? Infinity) < LIMIT_MS),
}
