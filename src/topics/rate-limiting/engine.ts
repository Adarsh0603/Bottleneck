import { CLIENTS, Gateway, TICKS_PER_SECOND, type Client, type Config } from './gate'
import type { RateState } from './types'

export interface RateMetrics {
  ticks: number // since the setup last changed
  sent: Record<Client, number>
  rejected: Record<Client, number> // turned away, for any reason
  served: Record<Client, number>
  rejectedTotal: number
  overload: number // times the API had no room, since the setup changed
  botRate: number // requests the bot gets past the limiter each second, lately
  waitMs: number // average wait in a leaky bucket
  waiting: number
}

export const configOf = (st: RateState): Partial<Config> => ({ ...st })

export const metricsOf = (g: Gateway): RateMetrics => {
  const t = g.tally
  const rejected = { ann: 0, bo: 0, bot: 0 }
  for (const c of CLIENTS) rejected[c] = t.rejected[c] + t.busy[c]
  return {
    ticks: g.flow.tick - g.since,
    sent: { ...t.sent },
    rejected,
    served: { ...t.served },
    rejectedTotal: CLIENTS.reduce((n, c) => n + rejected[c], 0),
    overload: t.overload,
    botRate: g.rateOf('bot'),
    waitMs: g.waitMs,
    waiting: g.waiting,
  }
}

export const seconds = (m: RateMetrics) => m.ticks / TICKS_PER_SECOND

// The lesson's simulation: a Gateway that follows the chapter's state.
export class RateSim {
  readonly gateway: Gateway

  constructor(rng?: () => number) {
    this.gateway = new Gateway(rng)
  }

  get flow() {
    return this.gateway.flow
  }

  get tick() {
    return this.gateway.flow.tick
  }

  apply(st: RateState) {
    this.gateway.configure(configOf(st))
  }

  step() {
    this.gateway.flow.step()
  }

  get metrics(): RateMetrics {
    return metricsOf(this.gateway)
  }
}
