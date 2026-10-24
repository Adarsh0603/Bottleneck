import { useTicker } from '../../core/flow/useTicker'
import type { Runtime, TopicSpec } from '../../core/types'
import { CHAPTERS } from './chapters'
import Controls from './Controls'
import { ConsistentSim, type ConsistentMetrics } from './engine'
import Scene from './Scene'
import Stats from './Stats'
import type { Beat, ConsistentState } from './types'
import { TICKS_PER_SECOND } from './world'

function useRuntime(stRef: { current: ConsistentState }, paused: boolean): Runtime<ConsistentSim, ConsistentMetrics> {
  const { sim, simRef, lastTickAt } = useTicker(
    () => {
      const s = new ConsistentSim()
      s.apply(stRef.current)
      return s
    },
    TICKS_PER_SECOND,
    paused,
  )
  return { sim, simRef, lastTickAt, metrics: sim.metrics, tick: sim.tick }
}

export const consistentHashing: TopicSpec<ConsistentState, ConsistentSim, ConsistentMetrics, Beat> = {
  chapters: CHAPTERS,
  useRuntime,
  sync: (sim, st) => sim.apply(st),
  Scene,
  Stats,
  Controls,
  feedback: (prev, next) => ({ crash: next.down !== null && prev.down === null, rise: next.nodes > prev.nodes }),
  dropCount: (sim) => sim.flow.stats.dropped,
}
