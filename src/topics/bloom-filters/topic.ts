import { useTicker } from '../../core/flow/useTicker'
import type { Runtime, TopicSpec } from '../../core/types'
import { CHAPTERS } from './chapters'
import Controls from './Controls'
import { BloomSim, type BloomMetrics } from './engine'
import Scene from './Scene'
import Stats from './Stats'
import type { Beat, BloomState } from './types'
import { TICKS_PER_SECOND } from './world'

function useRuntime(stRef: { current: BloomState }, paused: boolean): Runtime<BloomSim, BloomMetrics> {
  const { sim, simRef, lastTickAt } = useTicker(
    () => {
      const s = new BloomSim()
      s.apply(stRef.current)
      return s
    },
    TICKS_PER_SECOND,
    paused,
  )
  return { sim, simRef, lastTickAt, metrics: sim.metrics, tick: sim.tick }
}

export const bloomFilters: TopicSpec<BloomState, BloomSim, BloomMetrics, Beat> = {
  chapters: CHAPTERS,
  useRuntime,
  sync: (sim, st) => sim.apply(st),
  Scene,
  Stats,
  Controls,
  feedback: (prev, next) => ({ crash: next.drop > prev.drop && !next.counting }),
  dropCount: () => 0,
}
