import { useTicker } from '../../core/flow/useTicker'
import type { Runtime, TopicSpec } from '../../core/types'
import { CHAPTERS } from './chapters'
import Controls from './Controls'
import { CapSim, type CapMetrics } from './engine'
import Scene from './Scene'
import Stats from './Stats'
import type { Beat, CapState } from './types'
import { TICKS_PER_SECOND } from './world'

function useRuntime(stRef: { current: CapState }, paused: boolean): Runtime<CapSim, CapMetrics> {
  const { sim, simRef, lastTickAt } = useTicker(
    () => {
      const s = new CapSim()
      s.apply(stRef.current)
      return s
    },
    TICKS_PER_SECOND,
    paused,
  )
  return { sim, simRef, lastTickAt, metrics: sim.metrics, tick: sim.tick }
}

export const cap: TopicSpec<CapState, CapSim, CapMetrics, Beat> = {
  chapters: CHAPTERS,
  useRuntime,
  sync: (sim, st) => sim.apply(st),
  Scene,
  Stats,
  Controls,
  feedback: (prev, next) => ({ crash: next.partitioned && !prev.partitioned, rise: false }),
  dropCount: (sim) => sim.flow.stats.dropped,
}
