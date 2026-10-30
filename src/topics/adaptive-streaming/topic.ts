import { useTicker } from '../../core/flow/useTicker'
import type { Runtime, TopicSpec } from '../../core/types'
import { CHAPTERS } from './chapters'
import Controls from './Controls'
import { StreamSim, type StreamMetrics } from './engine'
import Scene from './Scene'
import Stats from './Stats'
import type { Beat, StreamState } from './types'
import { TICKS_PER_SECOND } from './world'

function useRuntime(stRef: { current: StreamState }, paused: boolean): Runtime<StreamSim, StreamMetrics> {
  const { sim, simRef, lastTickAt } = useTicker(
    () => {
      const s = new StreamSim()
      s.apply(stRef.current)
      return s
    },
    TICKS_PER_SECOND,
    paused,
  )
  return { sim, simRef, lastTickAt, metrics: sim.metrics, tick: sim.tick }
}

export const adaptiveStreaming: TopicSpec<StreamState, StreamSim, StreamMetrics, Beat> = {
  chapters: CHAPTERS,
  useRuntime,
  sync: (sim, st) => sim.apply(st),
  Scene,
  Stats,
  Controls,
  feedback: () => ({}),
  dropCount: () => 0,
}
