import { useTicker } from '../../core/flow/useTicker'
import type { Runtime, TopicSpec } from '../../core/types'
import { CHAPTERS } from './chapters'
import Controls from './Controls'
import { ShopSim, type ShopMetrics } from './engine'
import Scene from './Scene'
import { TICKS_PER_SECOND } from './shop'
import Stats from './Stats'
import type { Beat, ShopState } from './types'

function useRuntime(stRef: { current: ShopState }, paused: boolean): Runtime<ShopSim, ShopMetrics> {
  const { sim, simRef, lastTickAt } = useTicker(
    () => {
      const s = new ShopSim()
      s.apply(stRef.current)
      return s
    },
    TICKS_PER_SECOND,
    paused,
  )
  return { sim, simRef, lastTickAt, metrics: sim.metrics, tick: sim.tick }
}

export const circuitBreakers: TopicSpec<ShopState, ShopSim, ShopMetrics, Beat> = {
  chapters: CHAPTERS,
  useRuntime,
  sync: (sim, st) => sim.apply(st),
  Scene,
  Stats,
  Controls,
  feedback: (prev, next) => ({
    crash: false,
    rise: next.breaker !== prev.breaker || next.fallback !== prev.fallback || next.retries > prev.retries,
  }),
  dropCount: (sim) => sim.flow.stats.dropped,
}
