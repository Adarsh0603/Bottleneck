import type { BuildTask } from '../../core/build/types'
import { FlowSim, type FlowNode, type Job } from '../../core/flow/engine'
import { Router, Source, Worker } from '../../core/flow/nodes'
import { LB, MAX_SERVERS, SERVER_X, slotZ, SPIKE, TICKS_PER_SECOND, TRIP_TICKS, USERS } from './world'

// Build it: the flash sale. Quiet traffic, then a rush, over and over. Only
// two servers in the toolbox, and the rush needs five.
//   - Servers alone: two can't take the rush.
//   - A server in front (the decoy): users only reach that one.
//   - A load balancer and an autoscaler: it adds servers on the empty pads,
//     but they boot for 8 seconds, so the rush still overflows...
//   - ...unless it keeps a couple of spare servers running.

const QUIET_SECONDS = SPIKE.quietSeconds
const BOOT_SECONDS = 8
const TARGET = 0.7

const backPad = (i: number) => `back-${i}`

// Traffic that waits quietly, then rushes, and remembers whether the last
// rush got through with nothing turned away.
export class Rush extends Source {
  clean: boolean | null = null
  private startDrops = 0
  private wasRush = false

  inRush(tick: number) {
    return (tick / TICKS_PER_SECOND) % (QUIET_SECONDS + SPIKE.peakSeconds) >= QUIET_SECONDS
  }

  emit(sim: FlowSim) {
    const rush = this.inRush(sim.tick)
    if (rush && !this.wasRush) this.startDrops = sim.stats.dropped
    if (!rush && this.wasRush) this.clean = sim.stats.dropped === this.startDrops
    this.wasRush = rush
    this.rate = (rush ? SPIKE.peak : SPIKE.quiet) / TICKS_PER_SECOND
    super.emit(sim)
  }
}

// Watches the servers behind the balancer. Every second it sizes the fleet
// so they'd be about 70% busy, plus `spare` extra, launching new servers on
// empty pads. It only ever removes servers it launched itself.
class Autoscaler implements FlowNode {
  alive = true
  readonly key: string
  private front: string
  private spare: number
  private booting = new Map<string, number>() // pad → tick it's ready
  private launched = new Set<string>()
  private draining = new Set<string>()
  private demand: number[] = []
  private lastScaleIn = -Infinity
  private started = false

  constructor(key: string, front: string, spare: number) {
    this.key = key
    this.front = front
    this.spare = spare
  }

  receive(job: Job, sim: FlowSim) {
    sim.drop(job, this.key)
  }

  process(sim: FlowSim) {
    // The fleet it's set up with is already running.
    if (!this.started) {
      this.started = true
      const have = sim.targets(this.front).length
      for (let k = have; k < Math.max(1, this.spare); k++) this.launch(sim, 0)
    }
    for (const [pad, ready] of this.booting) {
      if (sim.tick < ready) continue
      sim.link(this.front, pad, TRIP_TICKS)
      this.booting.delete(pad)
    }
    for (const pad of this.draining) {
      const node = sim.node(pad)
      if (node && sim.pending(node) > 0) continue
      sim.remove(pad)
      this.draining.delete(pad)
      this.launched.delete(pad)
    }

    const running = sim.targets(this.front).filter((n): n is Worker => n instanceof Worker)
    this.demand.push(running.length === 0 ? 0 : running.reduce((sum, w) => sum + w.load() / w.slots, 0) / running.length)
    if (this.demand.length > TICKS_PER_SECOND * 2) this.demand.shift()
    if (sim.tick % TICKS_PER_SECOND !== 0) return

    const demand = this.demand.reduce((a, b) => a + b, 0) / this.demand.length
    const desired = Math.min(MAX_SERVERS, Math.max(1, Math.ceil((running.length * demand) / TARGET) + this.spare))
    const fleet = running.length + this.booting.size
    if (desired > fleet) {
      for (let k = fleet; k < desired; k++) this.launch(sim, BOOT_SECONDS * TICKS_PER_SECOND)
    } else if (desired < fleet && this.booting.size === 0 && sim.tick - this.lastScaleIn >= TICKS_PER_SECOND * 2) {
      const pad = [...this.launched].reverse().find((p) => !this.draining.has(p))
      if (!pad) return
      sim.unlink(this.front, pad)
      this.draining.add(pad)
      this.lastScaleIn = sim.tick
    }
  }

  // A new server on the first empty pad. It joins the balancer once booted.
  private launch(sim: FlowSim, bootTicks: number) {
    const pad = Array.from({ length: MAX_SERVERS }, (_, i) => backPad(i)).find((p) => !sim.node(p))
    if (!pad) return
    sim.add(new Worker(pad))
    this.launched.add(pad)
    if (bootTicks > 0) this.booting.set(pad, sim.tick + bootTicks)
    else sim.link(this.front, pad, TRIP_TICKS)
  }
}

export const FLASH_SALE: BuildTask = {
  title: 'Build it: the flash sale.',
  sub: 'Rushes come every few seconds. New servers take 8 seconds to boot.',
  goal: `Get through a rush of ${SPIKE.peak} req/s with no errors.`,
  win: 'A load balancer, an autoscaler, and spare servers to hold the rush while new ones boot.',
  holdSeconds: 1,
  rps: SPIKE.quiet,
  shot: { target: [-1.2, 0.6, 0], zoom: 0.8 },
  fixed: [{ id: 'users', kind: 'users', x: USERS.x, z: USERS.z }],
  pads: [
    { id: 'front', x: LB.x, z: LB.z, accepts: ['balancer', 'server'] },
    { id: 'scaler', x: LB.x + 1.8, z: slotZ(5) + 0.4, accepts: ['autoscaler'] },
    ...Array.from({ length: MAX_SERVERS }, (_, i) => ({ id: backPad(i), x: SERVER_X, z: slotZ(i), accepts: ['server' as const] })),
  ],
  toolbox: [
    { kind: 'balancer', count: 1 },
    { kind: 'server', count: 2 },
    { kind: 'autoscaler', count: 1 },
  ],
  settings: [{ id: 'spare', label: 'spare server', when: 'autoscaler', min: 0, max: 3, step: 1, initial: 0 }],

  assemble(placed, settings, rng) {
    const flow = new FlowSim(rng)
    flow.add(new Rush('users'))

    const front = placed.front
    if (front === 'balancer') flow.add(new Router('front')).algorithm = 'least-connections'
    if (front === 'server') flow.add(new Worker('front'))
    if (front) flow.link('users', 'front', TRIP_TICKS)

    for (let i = 0; i < MAX_SERVERS; i++) {
      const pad = backPad(i)
      if (placed[pad] !== 'server') continue
      flow.add(new Worker(pad))
      if (front === 'balancer') flow.link('front', pad, TRIP_TICKS)
    }
    if (placed.scaler === 'autoscaler' && front === 'balancer') flow.add(new Autoscaler('scaler', 'front', settings.spare ?? 0))
    return flow
  },

  check: (_m, _placed, _settings, flow) => {
    const users = flow?.node('users')
    return users instanceof Rush && users.clean === true
  },
}
