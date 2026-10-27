import { TICKS_PER_SECOND } from '../../core/build/run'
import type { BuildTask } from '../../core/build/types'
import { FlowSim, type FlowNode, type Job } from '../../core/flow/engine'
import { Source, Worker } from '../../core/flow/nodes'
import { Assigner, KEY_COUNT, type Mode } from './ring'
import { RING, nodeSpot, APP, USERS } from './world'

// Build it: 18 req/s on a cache tier of up to five servers, and at 10
// seconds one of them crashes. One pad in front of the servers decides which
// server holds each item:
//   - Nothing there: every request hits the database, which drowns.
//   - A load balancer there: it picks by hash % N. When the crash changes N,
//     nearly every item moves and the database drowns.
//   - A hash ring there: only the dead server's items move. With one spot
//     per server they all land on one neighbour, which is swamped; with
//     enough spots they spread across the survivors.
// Winning takes the ring, five servers (so four are left to share the work)
// and enough spots per server.

const RPS = 18
export const CRASH_TICK = 10 * TICKS_PER_SECOND
const SERVERS = 5
const MAX_DROPS = 10
const DB = { slots: 3, queueLimit: 8, workPerRequest: 14 }
const SERVER = { slots: 4, queueLimit: 8, workPerRequest: 10 }

const serverPads = Array.from({ length: SERVERS }, (_, i) => `server-${i}`)

// Users asking for random items among the popular ones.
class Users extends Source {
  constructor() {
    super('users')
    this.rate = RPS / TICKS_PER_SECOND
    this.keyOf = (rng) => Math.floor(rng() * KEY_COUNT)
    this.minWork = this.maxWork = 1
  }
}

// Sends each request on, instantly: `route` picks where.
class KeyRouter implements FlowNode {
  alive = true
  readonly key: string
  private route: (job: Job) => string

  constructor(key: string, route: (job: Job) => string) {
    this.key = key
    this.route = route
  }

  receive(job: Job, sim: FlowSim) {
    sim.forward(job, this.key, this.route(job))
  }
}

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

export const CRASH_DRILL: BuildTask = {
  title: 'Build it: survive a crash.',
  sub: 'A server crashes ten seconds in. A load balancer picks servers with hash % N; a hash ring uses the circle. Pick one, then add servers.',
  brief: [
    'Your app caches product pages on up to five cache servers, and a request must reach the server that holds that page. If it reaches the wrong one, it falls through to the database, which can only do about 4 lookups a second.',
    'A load balancer picks a server with hash % N, where N is how many servers are alive. A hash ring places each server on a circle at several spots, and each page belongs to the next spot around it.',
    'Ten seconds in, one server crashes. Its pages are gone, and N changes.',
    'Your job: survive the crash with almost no errors and no server over 85% busy. Watch the database when the crash hits.',
  ],
  goal: 'Survive the crash with almost no errors and no server over 85% busy.',
  win: 'The ring moved only the crashed server’s items, and several spots per server shared them between all the survivors.',
  replies: () => true,
  holdSeconds: 6,
  rps: RPS,
  shot: { target: [-1.4, 0.7, 0], zoom: 0.55 },
  fixed: [
    { id: 'users', kind: 'users', x: USERS.x, z: USERS.z },
    { id: 'app', kind: 'app', x: APP.x, z: APP.z },
    { id: 'db', kind: 'database', x: RING.x, z: RING.z },
  ],
  pads: [
    { id: 'front', x: -2.2, z: 0, accepts: ['balancer', 'ring'] },
    ...serverPads.map((id, i) => ({ id, ...nodeSpot(i, SERVERS, false), accepts: ['server' as const] })),
  ],
  toolbox: [
    { kind: 'ring', count: 1 },
    { kind: 'balancer', count: 1 },
    { kind: 'server', count: SERVERS },
  ],
  settings: [{ id: 'points', label: 'spot', when: 'ring', min: 1, max: 12, step: 1, initial: 1 }],
  watch: [{ kind: 'busy', key: 'db', label: 'Database busy' }],

  assemble(placed, settings, rng) {
    const flow = new FlowSim(rng)
    const front = placed.front
    const mode: Mode = front === 'ring' ? 'ring' : 'mod'
    const points = settings.points ?? 1
    const alive = serverPads.flatMap((id, i) => (placed[id] ? [i] : []))

    // Everything starts cached; the crash is what changes that.
    const assigner = new Assigner()
    assigner.update(alive, mode, points)

    flow.add(new Users())
    flow.link('users', 'app', 8)
    const db = flow.add(new Worker('db', DB))
    db.onFinish = (job) => {
      const k = job.key ?? 0
      if (assigner.owner[k] >= 0) assigner.warm[k] = true
    }
    for (const i of alive) {
      flow.add(new Worker(serverPads[i], SERVER))
      flow.link('front', serverPads[i], 6)
    }

    if (front) {
      flow.add(new KeyRouter('app', () => 'front'))
      flow.add(
        new KeyRouter('front', (job) => {
          const k = job.key ?? 0
          const owner = assigner.owner[k]
          return owner >= 0 && assigner.warm[k] ? serverPads[owner] : 'db'
        }),
      )
      flow.link('app', 'front', 5)
      flow.link('front', 'db', 6)
    } else {
      flow.add(new KeyRouter('app', () => 'db'))
      flow.link('app', 'db', 10)
    }

    if (alive.length > 0) {
      flow.add(
        new Crash(() => {
          const dead = alive[0]
          const server = flow.node(serverPads[dead])!
          server.alive = false
          flow.fail(serverPads[dead])
          assigner.update(alive.slice(1), mode, points)
        }),
      )
    }
    return flow
  },

  check: (m, placed, _settings, flow) =>
    !!flow &&
    placed.front !== undefined &&
    flow.tick > CRASH_TICK + 3 * TICKS_PER_SECOND &&
    flow.stats.dropped < MAX_DROPS &&
    m.busiest < 0.85,
}
