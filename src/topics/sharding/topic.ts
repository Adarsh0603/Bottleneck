import { useTicker } from '../../core/flow/useTicker'
import type { Runtime, TopicSpec } from '../../core/types'
import { CHAPTERS } from './chapters'
import Controls from './Controls'
import { ShardingSim, type ShardingMetrics } from './engine'
import Scene from './Scene'
import Stats from './Stats'
import type { Beat, ShardingState } from './types'
import { TICKS_PER_SECOND } from './world'

function useRuntime(stRef: { current: ShardingState }, paused: boolean): Runtime<ShardingSim, ShardingMetrics> {
  const { sim, simRef, lastTickAt } = useTicker(
    () => {
      const s = new ShardingSim()
      s.apply(stRef.current)
      return s
    },
    TICKS_PER_SECOND,
    paused,
  )
  return { sim, simRef, lastTickAt, metrics: sim.metrics, tick: sim.tick }
}

export const sharding: TopicSpec<ShardingState, ShardingSim, ShardingMetrics, Beat> = {
  chapters: CHAPTERS,
  useRuntime,
  sync: (sim, st) => sim.apply(st),
  Scene,
  Stats,
  Controls,
  feedback: (prev, next) => ({ crash: next.down !== null && prev.down === null, rise: next.shards > prev.shards }),
  dropCount: (sim) => sim.flow.stats.dropped,
}
