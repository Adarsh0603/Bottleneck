import { TICKS_PER_SECOND } from '../../core/build/run'
import type { BuildTask } from '../../core/build/types'
import { FlowSim, type FlowNode, type Job } from '../../core/flow/engine'
import { Source, Worker } from '../../core/flow/nodes'
import type { V3 } from '../../core/types'

// Build it: two apps, each with users in the East region and a primary in
// the West. Ten seconds in the link between the regions is cut, for ten
// seconds. For each app the learner chooses what the East side does while
// the link is down:
//   - Refuse: East turns its users away, so it never shows old data or takes
//     a write the primary doesn't know about. Safe, but people get errors.
//   - Answer: East keeps serving from its own copy. Nobody is turned away,
//     but it shows old data, and writes on both sides can collide.
// A bank balance can't be wrong; a social feed can be a little old but must
// load. Winning takes the right choice for each.

const RPS = 10
const WRITE_SHARE = 0.2
const ITEMS = 30
const LAG = 6
const BACKGROUND_WRITES = 1.5 // per second, from other users on the West side
export const SPLIT_START = 6 * TICKS_PER_SECOND
export const SPLIT_END = 16 * TICKS_PER_SECOND
const SETTLE = 3 * TICKS_PER_SECOND
const MAX_TURNED_AWAY = 5

export type AppId = 'bank' | 'feed'
const APPS: AppId[] = ['bank', 'feed']
const LANE_Z: Record<AppId, number> = { bank: -3, feed: 3 }
const NAMES: Record<AppId, string> = { bank: 'Bank', feed: 'Feed' }
const MODES = ['Refuse', 'Answer']

type Kind = 'read' | 'write'

// What the learner needs to see about each app.
export interface Lane {
  wrong: number // old reads shown, plus writes that collided
  turnedAway: number
}
export const lanesOf = new WeakMap<FlowSim, Record<AppId, Lane>>()

const split = (flow: FlowSim) => flow.tick >= SPLIT_START && flow.tick <= SPLIT_END

// Users reading and writing items.
class Users extends Source {
  constructor(key: string) {
    super(key)
    this.rate = RPS / TICKS_PER_SECOND
    this.keyOf = (rng) => Math.floor(rng() * ITEMS)
    this.minWork = this.maxWork = 1
  }
}

// East's database. While the link is cut it either turns requests away or
// answers from its own copy.
class East extends Worker {
  private answers: boolean
  private lane: Lane
  private kindOf: WeakMap<Job, Kind>

  constructor(key: string, answers: boolean, lane: Lane, kindOf: WeakMap<Job, Kind>) {
    super(key, { slots: 4, queueLimit: 8 })
    this.answers = answers
    this.lane = lane
    this.kindOf = kindOf
  }

  receive(job: Job, sim: FlowSim) {
    this.kindOf.set(job, sim.rng() < WRITE_SHARE ? 'write' : 'read')
    if (split(sim) && !this.answers) {
      this.lane.turnedAway++
      return sim.drop(job, this.key)
    }
    super.receive(job, sim)
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

const fixedFor = (id: AppId) => [
  { id: `${id}-users`, kind: 'users' as const, x: -7.4, z: LANE_Z[id] },
  { id: `${id}-east`, kind: 'replica' as const, x: -2.8, z: LANE_Z[id] },
  { id: `${id}-west`, kind: 'database' as const, x: 2.6, z: LANE_Z[id] },
]

export const PARTITION_CALL: BuildTask = {
  title: 'Build it: the link goes down.',
  sub: 'Decide what East does for each app while the regions can’t talk, then ride out the split.',
  brief: [
    'Two apps run in two regions. Their users are in the East. The primary database is in the West, and East keeps a copy.',
    'Ten seconds in, the link between the regions is cut for ten seconds. Neither side can reach the other.',
    'For each app, choose what East does meanwhile. “Refuse” turns its users away, so it never shows old data. “Answer” keeps serving from its own copy: nobody is turned away, but the copy goes stale.',
    'The bank shows balances. The feed shows posts. Pick what each one can live with.',
  ],
  manualStart: true,
  goal: 'Ride out the split: no wrong balance shown, and no one turned away from the feed.',
  goalShort: 'No wrong balance · feed always loads',
  win: 'The bank refused rather than show a wrong balance. The feed kept answering, a little behind, and caught up when the link came back.',
  holdSeconds: 4,
  rps: RPS,
  shot: { target: [-2.4, 0.7, 0], zoom: 0.7 },
  fixed: APPS.flatMap(fixedFor),
  labels: APPS.flatMap((id) => [
    { at: [-7.4, 1.9, LANE_Z[id]] as V3, text: `${NAMES[id]} users` },
    { at: [-2.8, 1.9, LANE_Z[id]] as V3, text: `${NAMES[id]} · East copy` },
    { at: [2.6, 1.9, LANE_Z[id]] as V3, text: `${NAMES[id]} · West primary` },
  ]),
  pads: [],
  toolbox: [],
  settings: APPS.map((id) => ({
    id,
    label: `${NAMES[id]}: East`,
    when: 'replica' as const,
    min: 0,
    max: 1,
    step: 1,
    initial: 1,
    options: MODES,
  })),
  watch: [
    {
      kind: 'note',
      label: 'Link',
      read: (flow) => ({ text: split(flow) ? 'Cut' : 'Up', bad: split(flow) }),
    },
    {
      kind: 'note',
      label: 'Wrong balances shown',
      read: (flow) => {
        const n = lanesOf.get(flow)?.bank.wrong ?? 0
        return { text: String(n), bad: n > 0 }
      },
    },
    {
      kind: 'note',
      label: 'Feed users turned away',
      read: (flow) => {
        const n = lanesOf.get(flow)?.feed.turnedAway ?? 0
        return { text: String(n), bad: n > MAX_TURNED_AWAY }
      },
    },
  ],

  assemble(_placed, settings, rng) {
    const flow = new FlowSim(rng)
    const lanes: Record<AppId, Lane> = { bank: { wrong: 0, turnedAway: 0 }, feed: { wrong: 0, turnedAway: 0 } }
    lanesOf.set(flow, lanes)
    const ticking: ((sim: FlowSim) => void)[] = []

    for (const id of APPS) {
      const lane = lanes[id]
      const kindOf = new WeakMap<Job, Kind>()
      const versions = { east: new Int32Array(ITEMS), west: new Int32Array(ITEMS) }
      const dirty = { east: new Set<number>(), west: new Set<number>() }
      let shipping: { to: 'east' | 'west'; item: number; version: number; arrive: number }[] = []

      flow.add(new Users(`${id}-users`))
      const answers = settings[id] === 1
      const east = flow.add(new East(`${id}-east`, answers, lane, kindOf))
      const west = flow.add(new Worker(`${id}-west`, { slots: 4, queueLimit: 8 }))
      flow.link(`${id}-users`, `${id}-east`, 8)
      flow.link(`${id}-east`, `${id}-west`, 6)

      const send = (to: 'east' | 'west', item: number, version: number, tick: number) => shipping.push({ to, item, version, arrive: tick + LAG })

      east.workOf = (job) => (kindOf.get(job) === 'write' ? 8 : 6)
      east.onFinish = (job, sim) => {
        if (split(sim) && !answers) return // taken before the cut, settled as it stood then
        const item = job.key ?? 0
        if (kindOf.get(job) === 'write') {
          const version = ++versions.east[item]
          if (split(sim)) {
            dirty.east.add(item)
            if (dirty.west.has(item)) lane.wrong++ // both sides changed it
          } else send('west', item, version, sim.tick)
          return
        }
        const behind = versions.east[item] < versions.west[item]
        if (behind && !shipping.some((s) => s.to === 'east' && s.item === item)) lane.wrong++
      }
      west.workOf = () => 1

      ticking.push((sim) => {
        // Other users, on the West side, keep changing things.
        if (sim.rng() < BACKGROUND_WRITES / TICKS_PER_SECOND) {
          const item = Math.floor(sim.rng() * ITEMS)
          const version = ++versions.west[item]
          if (split(sim)) {
            dirty.west.add(item)
            if (dirty.east.has(item)) lane.wrong++
          } else send('east', item, version, sim.tick)
        }
        // Changes already on the wire when the link is cut still land.
        for (const s of shipping) {
          if (s.arrive > sim.tick && sim.tick !== SPLIT_START) continue
          const v = versions[s.to]
          v[s.item] = Math.max(v[s.item], s.version)
        }
        shipping = shipping.filter((s) => s.arrive > sim.tick && sim.tick !== SPLIT_START)
        if (sim.tick === SPLIT_END) {
          for (let i = 0; i < ITEMS; i++) {
            const v = Math.max(versions.east[i], versions.west[i])
            versions.east[i] = v
            versions.west[i] = v
          }
          dirty.east.clear()
          dirty.west.clear()
        }
      })
    }

    flow.add(new Clock('clock', (sim) => ticking.forEach((t) => t(sim))))
    return flow
  },

  problem(_m, _placed, _settings, flow) {
    const lanes = lanesOf.get(flow)
    if (!lanes) return null
    if (lanes.bank.wrong > 0) {
      return 'The bank showed a wrong balance while East was cut off, because it kept answering from a copy that was behind. A balance that’s wrong is worse than an error. Make East refuse.'
    }
    if (lanes.feed.turnedAway > MAX_TURNED_AWAY) {
      return `${lanes.feed.turnedAway} feed users were turned away. A feed that’s a few seconds old is fine; one that won’t load is not. Make East answer.`
    }
    return null
  },

  check: (_m, _placed, _settings, flow) => {
    const lanes = flow && lanesOf.get(flow)
    return !!flow && !!lanes && flow.tick > SPLIT_END + SETTLE && lanes.bank.wrong === 0 && lanes.feed.turnedAway <= MAX_TURNED_AWAY
  },
}
