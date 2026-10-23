import { useTicker } from '../../core/flow/useTicker'
import type { Runtime, TopicSpec } from '../../core/types'
import { CHAPTERS } from './chapters'
import Controls from './Controls'
import { CachingSim, TICKS_PER_SECOND, type CachingMetrics } from './engine'
import { REFERENCE } from './reference'
import Scene from './Scene'
import Stats from './Stats'
import type { Beat, CachingState } from './types'

function useRuntime(stRef: { current: CachingState }): Runtime<CachingSim, CachingMetrics> {
  const { sim, simRef, lastTickAt } = useTicker(() => {
    const s = new CachingSim()
    s.apply(stRef.current)
    return s
  }, TICKS_PER_SECOND)
  return { sim, simRef, lastTickAt, metrics: sim.metrics, tick: sim.tick }
}

export const caching: TopicSpec<CachingState, CachingSim, CachingMetrics, Beat> = {
  chapters: CHAPTERS,
  useRuntime,
  sync: (sim, st) => sim.apply(st),
  Scene,
  Stats,
  Controls,
  feedback: (prev, next) => ({
    crash: next.cacheDown && !prev.cacheDown,
    rise: (next.cache && !prev.cache) || (!next.cacheDown && prev.cacheDown),
  }),
  dropCount: (sim) => sim.flow.stats.dropped,
  reference: REFERENCE,
}
