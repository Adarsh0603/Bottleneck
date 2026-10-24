import { Bus, TEAMS, TICKS_PER_SECOND, type Config, type Team } from './bus'
import type { BusState } from './types'

export interface BusMetrics {
  errorRate: number // percent of events turned away or missed, lately
  doneRate: number // events finished per second, lately
  published: number
  missed: number // events a team never got, since the setup last changed
  lost: Record<Team, number>
  behind: Record<Team, number>
  disorder: number // events handled after a later event for the same product
  duplicates: number // work done twice
  ignored: number // repeats that were skipped
  outages: number // times Analytics has come back
  crashes: number
}

export const configOf = (st: BusState): Partial<Config> => ({
  rps: st.rps,
  mode: st.mode,
  present: { email: st.email > 0, stats: st.stats > 0, stock: st.stock > 0 },
  counts: { email: st.email, stats: st.stats, stock: st.stock },
  partitions: st.partitions,
  key: st.key,
  retention: st.retention,
  commit: st.commit,
  dedupe: st.dedupe,
  outage: st.outages ? { start: 5 * TICKS_PER_SECOND, length: 6 * TICKS_PER_SECOND, every: 14 * TICKS_PER_SECOND } : null,
  crashy: st.crashes,
})

export const metricsOf = (bus: Bus): BusMetrics => {
  const t = bus.tally
  const behind = { email: bus.behind('email'), stats: bus.behind('stats'), stock: bus.behind('stock') }
  return {
    errorRate: bus.errorRate,
    doneRate: bus.doneRate,
    published: t.published,
    missed: TEAMS.reduce((sum, team) => sum + t.lost[team], 0),
    lost: { ...t.lost },
    behind,
    disorder: t.disorder,
    duplicates: t.duplicates,
    ignored: t.ignored,
    outages: t.outages,
    crashes: t.crashes,
  }
}

// The lesson's simulation: a Bus that follows the chapter's state.
export class BusSim {
  readonly bus: Bus

  constructor(rng?: () => number) {
    this.bus = new Bus(rng)
  }

  get flow() {
    return this.bus.flow
  }

  get tick() {
    return this.bus.flow.tick
  }

  apply(st: BusState) {
    this.bus.configure(configOf(st))
  }

  step() {
    this.bus.flow.step()
    this.bus.sample()
  }

  get metrics(): BusMetrics {
    return metricsOf(this.bus)
  }
}
