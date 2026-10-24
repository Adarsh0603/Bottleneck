import { useTicker } from '../../core/flow/useTicker'
import type { Runtime, TopicSpec } from '../../core/types'
import { CHAPTERS } from './chapters'
import Controls from './Controls'
import { QueueSim, type QueueMetrics } from './engine'
import Scene from './Scene'
import Stats from './Stats'
import type { Beat, QueueState } from './types'
import { TICKS_PER_SECOND } from './world'

function useRuntime(stRef: { current: QueueState }, paused: boolean): Runtime<QueueSim, QueueMetrics> {
  const { sim, simRef, lastTickAt } = useTicker(
    () => {
      const s = new QueueSim()
      s.apply(stRef.current)
      return s
    },
    TICKS_PER_SECOND,
    paused,
  )
  return { sim, simRef, lastTickAt, metrics: sim.metrics, tick: sim.tick }
}

export const queues: TopicSpec<QueueState, QueueSim, QueueMetrics, Beat> = {
  chapters: CHAPTERS,
  useRuntime,
  sync: (sim, st) => sim.apply(st),
  Scene,
  Stats,
  Controls,
  feedback: (prev, next) => ({ crash: false, rise: next.workers > prev.workers || (next.queued && !prev.queued) }),
  dropCount: (sim) => sim.flow.stats.dropped,
}
