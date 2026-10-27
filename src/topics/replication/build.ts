import { TICKS_PER_SECOND } from '../../core/build/run'
import type { BuildTask } from '../../core/build/types'
import { FlowSim, type FlowNode, type Job } from '../../core/flow/engine'
import { Source, Worker } from '../../core/flow/nodes'

// Build it: a payments app on payday, 36 req/s, mostly reads. Ten seconds in
// the primary database dies. One pad for the primary, five for copies of it.
//   - Reads go to the copies; writes go to the primary. Every copy adds read
//     capacity, but each one also costs the primary a little to keep up to date.
//   - The primary ships each change to its copies, which apply it two
//     seconds later. A change shipped but not yet applied dies with the
//     primary: those payments are lost.
//   - "Confirming replicas" are copies a write waits for before it counts as
//     paid, so they always have it. It's safe, but each one holds a write
//     longer on the primary, which only has room for so many.
//   - After the crash the app waits two seconds, then promotes the copy with
//     the most data. The copies left must carry every read alone.
// Winning takes enough copies to survive losing the primary, and exactly the
// confirming replicas that lose no payment without drowning the primary.

const RPS = 36
const WRITE_SHARE = 0.1
const ITEMS = 40 // accounts
const LAG = 2 * TICKS_PER_SECOND
const READ_WORK = 12
const WRITE_WORK = 12
const SHIP_WORK = 2 // per copy, to keep it up to date
const CONFIRM_WORK = 14 // per confirming replica, waiting for its answer
export const CRASH_TICK = 10 * TICKS_PER_SECOND
export const FAILOVER_TICKS = 2 * TICKS_PER_SECOND
const MAX_DROPS = 20
const COPIES = 5

const copyPads = Array.from({ length: COPIES }, (_, i) => `copy-${i}`)
const COLUMN_X = 2.6
const COLUMN_Z = [-5.5, -3.3, -1.1, 1.1, 3.3, 5.5]

type Kind = 'read' | 'write'

// What the learner needs to see about the failover.
export interface Failover {
  down: boolean
  promoted: boolean
  lost: number // payments the dead primary had that the new one doesn't
}
export const failoverOf = new WeakMap<FlowSim, Failover>()

// Users reading and writing accounts.
class Users extends Source {
  constructor() {
    super('users')
    this.rate = RPS / TICKS_PER_SECOND
    this.keyOf = (rng) => Math.floor(rng() * ITEMS)
    this.minWork = this.maxWork = 1
  }
}

// Sends each request on, instantly: `route` picks where.
class KeyRouter implements FlowNode {
  alive = true
  readonly key: string
  private route: (job: Job) => string | undefined

  constructor(key: string, route: (job: Job) => string | undefined) {
    this.key = key
    this.route = route
  }

  receive(job: Job, sim: FlowSim) {
    const to = this.route(job)
    if (to) sim.forward(job, this.key, to)
    else sim.drop(job, 'primary')
  }
}

// Does something every tick, e.g. applies changes that have reached a copy.
class Clock implements FlowNode {
  alive = true
  readonly key: string
  private tick: (sim: FlowSim) => void

  constructor(key: string, tick: (sim: FlowSim) => void) {
    this.key = key
    this.tick = tick
  }

  receive() {}

  process(sim: FlowSim) {
    this.tick(sim)
  }
}

export const PAYDAY_CRASH: BuildTask = {
  title: 'Build it: payday, and the primary dies.',
  sub: 'Place a primary and its replicas, choose how many confirm each payment, then survive the crash.',
  brief: [
    'It’s payday. Customers pay and check their balance, 36 requests a second. Checking a balance is a read. Paying is a write: it must be saved.',
    'Every payment is saved on the primary database, which copies it to the replicas. Copies arrive 2 seconds late. Balance checks go to the replicas, so the primary only handles payments.',
    'In 10 seconds the primary crashes. After 2 seconds the app promotes the replica with the most data. A payment that hadn’t reached it yet is gone, though the customer was told it worked.',
    'Your job: build it so the app keeps running through the crash and no payment is lost. “Confirming replicas” are copies that must hold a payment before the customer is told it worked, so they are never behind. But every confirmation keeps the primary busy longer.',
  ],
  manualStart: true,
  goal: 'Survive the crash: zero payments lost, errors under 1%, and no database over 85% busy.',
  goalShort: 'No payment lost · errors under 1%',
  win: 'The replicas carried every balance check. A confirming replica had every payment, so the new primary lost none, and the old one was never slowed too much.',
  replies: () => true,
  holdSeconds: 6,
  rps: RPS,
  shot: { target: [-1.2, 0.7, 0], zoom: 0.62 },
  fixed: [
    { id: 'users', kind: 'users', x: -7, z: 0 },
    { id: 'app', kind: 'app', x: -3.8, z: 0 },
  ],
  pads: [
    { id: 'primary', x: COLUMN_X, z: COLUMN_Z[0], accepts: ['database'] },
    ...copyPads.map((id, i) => ({ id, x: COLUMN_X, z: COLUMN_Z[i + 1], accepts: ['replica' as const] })),
  ],
  toolbox: [
    { kind: 'database', count: 1 },
    { kind: 'replica', count: COPIES },
  ],
  settings: [{ id: 'confirm', label: 'confirming replica', when: 'database', min: 0, max: 3, step: 1, initial: 0 }],
  watch: [
    { kind: 'busy', key: '', label: 'Busiest database' },
    {
      kind: 'note',
      label: 'Payments lost',
      read: (flow) => {
        const f = failoverOf.get(flow)
        if (!f?.promoted) return { text: f?.down ? '…' : '0', bad: false }
        return { text: String(f.lost), bad: f.lost > 0 }
      },
    },
  ],

  assemble(placed, settings, rng) {
    const flow = new FlowSim(rng)
    const kindOf = new WeakMap<Job, Kind>()
    const state: Failover = { down: false, promoted: false, lost: 0 }
    failoverOf.set(flow, state)

    const copies = copyPads.filter((id) => placed[id])
    const nodes = placed.primary ? ['primary', ...copies] : copies
    const versions = new Map(nodes.map((id) => [id, new Int32Array(ITEMS)]))
    const committed = new Int32Array(ITEMS) // the newest version of each account
    let shipping: { to: string; item: number; version: number; arrive: number }[] = []
    let leader = 'primary'
    let up = !!placed.primary

    const followers = () => copies.filter((id) => id !== leader)
    const confirming = () => followers().slice(0, settings.confirm ?? 0)

    flow.add(new Users())
    flow.link('users', 'app', 8)

    // Reads to the copies in turn, writes to the leader.
    let turn = 0
    const route = (job: Job) => {
      const leaderOrNone = up ? leader : undefined
      if (kindOf.get(job) === 'write') return leaderOrNone
      const f = followers()
      return f.length ? f[turn++ % f.length] : leaderOrNone
    }

    for (const id of nodes) {
      const w = flow.add(new Worker(id, { slots: 8, queueLimit: 16 }))
      w.workOf = (job) =>
        kindOf.get(job) === 'write'
          ? WRITE_WORK + SHIP_WORK * followers().length + CONFIRM_WORK * confirming().length
          : READ_WORK
      w.onFinish = (job) => {
        if (kindOf.get(job) !== 'write') return
        const item = job.key ?? 0
        const version = ++versions.get(id)![item]
        committed[item] = version
        for (const to of followers()) {
          if (confirming().includes(to)) versions.get(to)![item] = version
          else shipping.push({ to, item, version, arrive: flow.tick + LAG })
        }
      }
      flow.link('app', id, 8)
    }

    // The app tells reads from writes as they arrive.
    flow.add(
      new KeyRouter('app', (job) => {
        if (!kindOf.has(job)) kindOf.set(job, flow.rng() < WRITE_SHARE ? 'write' : 'read')
        return route(job)
      }),
    )

    flow.add(
      new Clock('clock', (sim) => {
        for (const s of shipping) {
          if (s.arrive > sim.tick) continue
          const v = versions.get(s.to)!
          v[s.item] = Math.max(v[s.item], s.version)
        }
        shipping = shipping.filter((s) => s.arrive > sim.tick)

        if (!placed.primary) return
        if (sim.tick === CRASH_TICK) {
          flow.node('primary')!.alive = false
          flow.fail('primary')
          shipping = []
          up = false
          state.down = true
        }
        if (sim.tick === CRASH_TICK + FAILOVER_TICKS && copies.length > 0) {
          // The copy with the most data takes over; the rest copy from it.
          const total = (id: string) => versions.get(id)!.reduce((a, b) => a + b, 0)
          const best = copies.reduce((a, b) => (total(b) > total(a) ? b : a))
          const data = versions.get(best)!
          state.lost = committed.reduce((sum, v, i) => sum + Math.max(0, v - data[i]), 0)
          for (const [id, v] of versions) if (id !== best) v.set(data)
          committed.set(data)
          leader = best
          up = true
          state.promoted = true
        }
      }),
    )

    return flow
  },

  problem(m, placed, settings, flow) {
    const state = failoverOf.get(flow)!
    const copies = copyPads.filter((id) => placed[id]).length
    const confirm = settings.confirm ?? 0
    const secs = flow.tick / TICKS_PER_SECOND

    if (!placed.primary) return 'There is no primary, so nothing can save a payment. Every payment fails. Place the database on the top pad.'
    if (state.down && !state.promoted && copies === 0) {
      return 'The primary is down and there is no replica to take over, so every payment fails. Add replicas before the crash.'
    }
    if (state.promoted && state.lost > 0) {
      return `${state.lost} payments were lost. The replica that took over was behind the old primary, and the customers were told they had paid. Make a replica confirm each payment, so one always has them all.`
    }
    if (copies === 0 && secs > 3) {
      return 'Every request, payments and balance checks, lands on the one database. It can’t keep up, so payments fail. Add replicas: balance checks go to them.'
    }
    const hot = m.busiest >= 0.85 || m.dropRate >= 1
    if (hot && secs > 4) {
      if (confirm >= 2) {
        return 'The primary is struggling. Each payment now waits for several replicas to confirm before it is done, and that holds up every payment behind it. Fewer confirming replicas.'
      }
      const left = state.down ? copies - 1 : copies
      if (left < 3) {
        return state.down
          ? 'The primary is gone, so the remaining replicas answer every balance check, and they can’t keep up. You needed more replicas before the crash.'
          : 'The replicas can’t answer every balance check in time. Add more replicas, and remember one will take over as primary when it crashes.'
      }
    }
    return null
  },

  check: (m, placed, _settings, flow) => {
    const state = flow && failoverOf.get(flow)
    return (
      !!flow &&
      !!state &&
      !!placed.primary &&
      state.promoted &&
      state.lost === 0 &&
      flow.tick > CRASH_TICK + FAILOVER_TICKS + 3 * TICKS_PER_SECOND &&
      flow.stats.dropped < MAX_DROPS &&
      m.dropRate < 1 &&
      m.busiest < 0.85
    )
  },
}
