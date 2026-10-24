import { useTicker } from '../../core/flow/useTicker'
import type { Runtime, TopicSpec } from '../../core/types'
import { CHAPTERS } from './chapters'
import Controls from './Controls'
import { RateSim, type RateMetrics } from './engine'
import { TICKS_PER_SECOND } from './gate'
import Scene from './Scene'
import Stats from './Stats'
import type { Beat, RateState } from './types'

function useRuntime(stRef: { current: RateState }, paused: boolean): Runtime<RateSim, RateMetrics> {
  const { sim, simRef, lastTickAt } = useTicker(
    () => {
      const s = new RateSim()
      s.apply(stRef.current)
      return s
    },
    TICKS_PER_SECOND,
    paused,
  )
  return { sim, simRef, lastTickAt, metrics: sim.metrics, tick: sim.tick }
}

export const rateLimiting: TopicSpec<RateState, RateSim, RateMetrics, Beat> = {
  chapters: CHAPTERS,
  useRuntime,
  sync: (sim, st) => sim.apply(st),
  Scene,
  Stats,
  Controls,
  feedback: (prev, next) => ({
    crash: false,
    rise: next.gateways > prev.gateways || next.limiting !== prev.limiting || next.algo !== prev.algo,
  }),
  dropCount: (sim) => sim.flow.stats.dropped,
}
