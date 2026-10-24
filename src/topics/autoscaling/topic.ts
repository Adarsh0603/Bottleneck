import { useTicker } from '../../core/flow/useTicker'
import type { Runtime, TopicSpec } from '../../core/types'
import { CHAPTERS } from './chapters'
import Controls from './Controls'
import { AutoscaleSim, type AutoscaleMetrics } from './engine'
import Scene from './Scene'
import Stats from './Stats'
import type { AutoscaleState, Beat } from './types'
import { TICKS_PER_SECOND } from './world'

function useRuntime(stRef: { current: AutoscaleState }, paused: boolean): Runtime<AutoscaleSim, AutoscaleMetrics> {
  const { sim, simRef, lastTickAt } = useTicker(
    () => {
      const s = new AutoscaleSim()
      s.apply(stRef.current)
      return s
    },
    TICKS_PER_SECOND,
    paused,
  )
  return { sim, simRef, lastTickAt, metrics: sim.metrics, tick: sim.tick }
}

export const autoscaling: TopicSpec<AutoscaleState, AutoscaleSim, AutoscaleMetrics, Beat> = {
  chapters: CHAPTERS,
  useRuntime,
  sync: (sim, st) => sim.apply(st),
  Scene,
  Stats,
  Controls,
  feedback: (prev, next) => ({ rise: !next.auto && next.servers > prev.servers }),
  dropCount: (sim) => sim.flow.stats.dropped,
}
