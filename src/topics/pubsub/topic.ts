import { useTicker } from '../../core/flow/useTicker'
import type { Runtime, TopicSpec } from '../../core/types'
import { TICKS_PER_SECOND } from './bus'
import { CHAPTERS } from './chapters'
import Controls from './Controls'
import { BusSim, type BusMetrics } from './engine'
import Scene from './Scene'
import Stats from './Stats'
import type { Beat, BusState } from './types'

function useRuntime(stRef: { current: BusState }, paused: boolean): Runtime<BusSim, BusMetrics> {
  const { sim, simRef, lastTickAt } = useTicker(
    () => {
      const s = new BusSim()
      s.apply(stRef.current)
      return s
    },
    TICKS_PER_SECOND,
    paused,
  )
  return { sim, simRef, lastTickAt, metrics: sim.metrics, tick: sim.tick }
}

export const pubsub: TopicSpec<BusState, BusSim, BusMetrics, Beat> = {
  chapters: CHAPTERS,
  useRuntime,
  sync: (sim, st) => sim.apply(st),
  Scene,
  Stats,
  Controls,
  feedback: (prev, next) => ({
    crash: false,
    rise: next.email > prev.email || next.stock > prev.stock || next.partitions > prev.partitions || next.mode !== prev.mode,
  }),
  dropCount: (sim) => sim.flow.stats.dropped,
}
