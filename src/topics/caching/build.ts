import { TICKS_PER_SECOND } from '../../core/build/run'
import type { BuildTask } from '../../core/build/types'
import { Cache } from '../../core/flow/cache'
import { FlowSim } from '../../core/flow/engine'
import { Source, Worker } from '../../core/flow/nodes'
import { popularItem } from './engine'
import { APP, CACHE, DB, USERS_X } from './world'

// Build it: the database is drowning at 10 req/s. One pad between the app
// servers and the database.
//   - Nothing there: every request hits the database.
//   - A server there (the decoy): it just passes requests through.
//   - A cache there: popular items get answered from memory, but only if
//     it's big enough to hold them.

const RPS = 10

export const SAVE_THE_DATABASE: BuildTask = {
  title: 'Build it: save the database.',
  sub: 'Put something between the app and the database, then tune it.',
  goal: 'Keep the database under 75% busy at 10 req/s.',
  win: 'A cache big enough to hold the popular items.',
  holdSeconds: 6,
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
  settings: [{ id: 'size', label: 'item', when: 'cache', min: 5, max: 40, step: 5, initial: 5 }],
  watch: [{ kind: 'busy', key: 'database', label: 'Database busy' }],

  assemble(placed, settings, rng) {
    const flow = new FlowSim(rng)
    const users = flow.add(new Source('users'))
    users.rate = RPS / TICKS_PER_SECOND
    users.keyOf = popularItem
    flow.add(new Worker('app', { slots: 32, queueLimit: 64, workPerRequest: 2 }))
    const db = flow.add(new Worker('database', { slots: 4, queueLimit: 8, workPerRequest: 15 }))
    flow.link('users', 'app', 8)

    const middle = placed.middle
    if (middle === 'cache') {
      const cache = flow.add(new Cache('middle'))
      cache.capacity = settings.size ?? 5
      db.onFinish = (job, sim) => job.key !== undefined && cache.fill(job.key, sim)
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

  check: (m) => m.dropRate < 1 && (m.busy.database ?? 1) < 0.75,
}
