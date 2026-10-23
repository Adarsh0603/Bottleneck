// The autoscaling system, on the shared flow engine:
//
//   users ──▶ load balancer ──▶ server slot 0
//                         ├──▶ server slot 1
//                         └──▶ ... up to six
//
// Traffic follows a pattern (steady, a day, spikes). With the autoscaler off,
// the fleet is whatever size it's set to. With it on, every second it looks
// at how busy the running servers were and sizes the fleet so they'd be about
// `target`% busy. New servers boot for a while before they take traffic;
// removed ones stop getting requests, finish what they hold, then go.

import { FlowSim } from '../../core/flow/engine'
import { Router, Source, Worker } from '../../core/flow/nodes'
import type { AutoscaleState } from './types'
import {
  COST_PER_SERVER,
  DAY,
  MAX_SERVERS,
  SECONDS_PER_HOUR,
  serverKey,
  SPIKE,
  START_HOUR,
  TICKS_PER_SECOND,
  TRIP_TICKS,
} from './world'

const WINDOW = TICKS_PER_SECOND * 3
const BUSY_WINDOW = TICKS_PER_SECOND * 2
const SCALE_IN_COOLDOWN = TICKS_PER_SECOND * 2

export interface Slot {
  state: 'booting' | 'running' | 'draining'
  startedAt: number
  readyAt: number
  worker: Worker
}

export interface AutoscaleMetrics {
  rps: number // traffic right now
  hour: number // time of day, 0–24, during a day
  running: number
  booting: number
  busy: number // running servers, recent average, 0–1
  dropRate: number // percent, over the last few seconds
  cost: number // $ a month for every server you're paying for
  spikeClean: boolean | null // did the last spike finish with no errors? null before the first
}

export class AutoscaleSim {
  readonly flow: FlowSim
  readonly slots: (Slot | undefined)[] = Array(MAX_SERVERS).fill(undefined)
  private users: Source
  private st: AutoscaleState | null = null
  private patternStart = 0
  private lastScaleIn = -Infinity
  private history: { completed: number; dropped: number; busy: number; demand: number }[] = []
  private spikeStartDrops = 0
  private wasSpike = false
  private spikeClean: boolean | null = null

  constructor(rng: () => number = Math.random) {
    this.flow = new FlowSim(rng)
    this.users = this.flow.add(new Source('users'))
    const lb = this.flow.add(new Router('lb'))
    lb.algorithm = 'least-connections'
    this.flow.link('users', 'lb', TRIP_TICKS)
  }

  get tick() {
    return this.flow.tick
  }

  apply(st: AutoscaleState) {
    const prev = this.st
    this.st = st
    if (!prev || prev.pattern !== st.pattern) this.patternStart = this.flow.tick
    // Start with a running fleet, then resize by hand only while the autoscaler is off.
    if (!prev) this.resize(st.auto ? st.min : st.servers)
    else if (!st.auto) this.resize(st.servers)
  }

  // Servers being paid for and not on their way out.
  get fleet() {
    return this.slots.filter((s) => s && s.state !== 'draining').length
  }

  private resize(n: number) {
    while (this.fleet < n) if (!this.launch(0)) break
    while (this.fleet > n) {
      const booting = this.lastIndex('booting')
      if (booting >= 0) this.remove(booting)
      else this.drain(this.lastIndex('running'))
    }
  }

  private lastIndex(state: Slot['state']) {
    for (let i = MAX_SERVERS - 1; i >= 0; i--) if (this.slots[i]?.state === state) return i
    return -1
  }

  private launch(bootTicks: number) {
    const i = this.slots.findIndex((s) => !s)
    if (i < 0) return false
    const worker = this.flow.add(new Worker(serverKey(i)))
    const t = this.flow.tick
    this.slots[i] = { state: bootTicks > 0 ? 'booting' : 'running', startedAt: t, readyAt: t + bootTicks, worker }
    if (bootTicks <= 0) this.flow.link('lb', worker.key, TRIP_TICKS)
    return true
  }

  // Out of rotation: no new requests, finish the ones it holds, then go.
  private drain(i: number) {
    const slot = this.slots[i]
    if (!slot) return
    this.flow.unlink('lb', slot.worker.key)
    slot.state = 'draining'
  }

  private remove(i: number) {
    const slot = this.slots[i]
    if (!slot) return
    this.flow.remove(slot.worker.key)
    this.slots[i] = undefined
  }

  private seconds() {
    return (this.flow.tick - this.patternStart) / TICKS_PER_SECOND
  }

  get hour() {
    return (START_HOUR + this.seconds() / SECONDS_PER_HOUR) % 24
  }

  get inSpike() {
    if (this.st?.pattern !== 'spike') return false
    return this.seconds() % (SPIKE.quietSeconds + SPIKE.peakSeconds) >= SPIKE.quietSeconds
  }

  // Traffic right now, from the pattern.
  get rps() {
    const st = this.st
    if (!st) return 0
    if (st.pattern === 'spike') return this.inSpike ? SPIKE.peak : SPIKE.quiet
    if (st.pattern === 'day') {
      const h = this.hour
      const a = DAY[Math.floor(h)]
      const b = DAY[(Math.floor(h) + 1) % 24]
      return a + (b - a) * (h - Math.floor(h))
    }
    return st.rps
  }

  step() {
    const st = this.st
    this.users.rate = this.rps / TICKS_PER_SECOND
    this.flow.step()
    const t = this.flow.tick

    // Booted servers join the balancer; drained ones leave once empty.
    this.slots.forEach((slot, i) => {
      if (slot?.state === 'booting' && t >= slot.readyAt) {
        slot.state = 'running'
        this.flow.link('lb', slot.worker.key, TRIP_TICKS)
      }
      if (slot?.state === 'draining' && this.flow.pending(slot.worker) === 0) this.remove(i)
    })

    const running = this.running()
    const mean = (f: (w: Worker) => number) => (running.length === 0 ? 0 : running.reduce((sum, w) => sum + f(w), 0) / running.length)
    this.history.push({
      completed: this.flow.stats.completed,
      dropped: this.flow.stats.dropped,
      busy: mean((w) => w.active.length / w.slots),
      // Busy plus waiting: past 1 when there's more work than workers.
      demand: mean((w) => w.load() / w.slots),
    })
    if (this.history.length > WINDOW + 1) this.history.shift()

    const spike = this.inSpike
    if (spike && !this.wasSpike) this.spikeStartDrops = this.flow.stats.dropped
    if (!spike && this.wasSpike) this.spikeClean = this.flow.stats.dropped === this.spikeStartDrops
    this.wasSpike = spike

    if (st?.auto && t % TICKS_PER_SECOND === 0) this.autoscale(st)
  }

  private running() {
    return this.slots.flatMap((s) => (s?.state === 'running' ? [s.worker] : []))
  }

  // Target tracking: size the fleet so the running servers would be about
  // `target`% busy. Waiting requests count too, so an overloaded fleet asks
  // for more than "100% busy" would. Add quickly; remove one at a time, with a
  // pause between.
  private autoscale(st: AutoscaleState) {
    const running = this.running().length
    const booting = this.slots.filter((s) => s?.state === 'booting').length
    const recent = this.history.slice(-BUSY_WINDOW)
    const demand = recent.reduce((sum, h) => sum + h.demand, 0) / Math.max(1, recent.length)
    const desired = Math.min(MAX_SERVERS, Math.max(st.min, Math.ceil((running * demand) / (st.target / 100))))
    const fleet = running + booting
    if (desired > fleet) {
      for (let k = fleet; k < desired; k++) this.launch(st.bootSeconds * TICKS_PER_SECOND)
    } else if (desired < fleet && booting === 0 && this.flow.tick - this.lastScaleIn >= SCALE_IN_COOLDOWN) {
      this.drain(this.lastIndex('running'))
      this.lastScaleIn = this.flow.tick
    }
  }

  get metrics(): AutoscaleMetrics {
    const h = this.history
    const first = h[0]
    const last = h[h.length - 1]
    const completed = h.length > 1 ? last.completed - first.completed : 0
    const dropped = h.length > 1 ? last.dropped - first.dropped : 0
    const recent = h.slice(-BUSY_WINDOW)
    return {
      rps: this.rps,
      hour: this.hour,
      running: this.running().length,
      booting: this.slots.filter((s) => s?.state === 'booting').length,
      busy: recent.length === 0 ? 0 : recent.reduce((sum, s) => sum + s.busy, 0) / recent.length,
      dropRate: completed + dropped === 0 ? 0 : (dropped / (completed + dropped)) * 100,
      cost: this.slots.filter(Boolean).length * COST_PER_SERVER,
      spikeClean: this.spikeClean,
    }
  }
}
