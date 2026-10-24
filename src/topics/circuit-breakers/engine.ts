import { Shop, TICKS_PER_SECOND, type BreakerState, type Config, type Dep } from './shop'
import type { ShopState } from './types'

export interface ShopMetrics {
  ticks: number // since the setup last changed
  browseOk: number // pages shown, with or without reviews
  browseDegraded: number // of those, pages without reviews
  browseFailed: number
  checkoutOk: number
  checkoutFailed: number
  gaveUp: number // users who stopped waiting
  turnedAway: number // no thread free and no room to wait
  threadsBusy: number
  threads: number
  stuck: number // threads that have waited on a call for over a second
  payRate: number // calls reaching Payments each second
  payOverloaded: number // calls Payments had no room for
  timeouts: number
  shed: number // failed at once, without a call
  needless: number // checkouts that failed while Payments was working
  waitMs: number
  breaker: Record<Dep, BreakerState>
}

export const configOf = (st: ShopState): Partial<Config> => ({
  pay: st.pay,
  rev: st.rev,
  reviews: st.reviews,
  timeout: st.timeout,
  retries: st.retries,
  backoff: st.backoff,
  breaker: { pay: st.breaker, rev: st.breaker },
  trip: st.trip,
  cooldown: st.cooldown,
  fallback: st.fallback,
  pool: st.pool,
  threads: st.threads,
})

export const metricsOf = (s: Shop): ShopMetrics => {
  const t = s.tally
  return {
    ticks: s.flow.tick - s.since,
    browseOk: t.ok.browse + t.degraded.browse,
    browseDegraded: t.degraded.browse,
    browseFailed: t.failed.browse,
    checkoutOk: t.ok.checkout,
    checkoutFailed: t.failed.checkout,
    gaveUp: t.gaveUp.browse + t.gaveUp.checkout,
    turnedAway: t.turnedAway,
    threadsBusy: s.shop.active.length,
    threads: s.cfg.threads,
    stuck: s.stuck,
    payRate: s.deps.pay.rate,
    payOverloaded: s.deps.pay.overloaded,
    timeouts: t.timeouts.pay + t.timeouts.rev,
    shed: t.shed.pay + t.shed.rev,
    needless: t.needless,
    waitMs: s.waitMs,
    breaker: { pay: s.breakers.pay.state, rev: s.breakers.rev.state },
  }
}

export const seconds = (m: ShopMetrics) => m.ticks / TICKS_PER_SECOND

// The lesson's simulation: a Shop that follows the chapter's state.
export class ShopSim {
  readonly shop: Shop

  constructor(rng?: () => number) {
    this.shop = new Shop(rng)
  }

  get flow() {
    return this.shop.flow
  }

  get tick() {
    return this.shop.flow.tick
  }

  apply(st: ShopState) {
    this.shop.configure(configOf(st))
  }

  step() {
    this.shop.flow.step()
  }

  get metrics(): ShopMetrics {
    return metricsOf(this.shop)
  }
}
