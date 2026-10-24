import { useTicker } from '../../core/flow/useTicker'
import type { Runtime, TopicSpec } from '../../core/types'
import { CHAPTERS } from './chapters'
import Controls from './Controls'
import { ConsensusSim, type ConsensusMetrics } from './engine'
import Scene from './Scene'
import Stats from './Stats'
import type { Beat, ConsensusState } from './types'
import { TICKS_PER_SECOND } from './world'

function useRuntime(stRef: { current: ConsensusState }, paused: boolean): Runtime<ConsensusSim, ConsensusMetrics> {
  const { sim, simRef, lastTickAt } = useTicker(
    () => {
      const s = new ConsensusSim()
      s.apply(stRef.current)
      return s
    },
    TICKS_PER_SECOND,
    paused,
  )
  return { sim, simRef, lastTickAt, metrics: sim.metrics, tick: sim.tick }
}

export const consensus: TopicSpec<ConsensusState, ConsensusSim, ConsensusMetrics, Beat> = {
  chapters: CHAPTERS,
  useRuntime,
  sync: (sim, st) => sim.apply(st),
  Scene,
  Stats,
  Controls,
  feedback: (prev, next) => ({ crash: next.down.length > prev.down.length, rise: false }),
  dropCount: () => 0,
}
