import { useTicker } from '../../core/flow/useTicker'
import type { Runtime, TopicSpec } from '../../core/types'
import { CHAPTERS } from './chapters'
import Controls from './Controls'
import { IdempotencySim, type IdempotencyMetrics } from './engine'
import Scene from './Scene'
import Stats from './Stats'
import type { Beat, IdempotencyState } from './types'
import { TICKS_PER_SECOND } from './world'

function useRuntime(stRef: { current: IdempotencyState }, paused: boolean): Runtime<IdempotencySim, IdempotencyMetrics> {
  const { sim, simRef, lastTickAt } = useTicker(
    () => {
      const s = new IdempotencySim()
      s.apply(stRef.current)
      return s
    },
    TICKS_PER_SECOND,
    paused,
  )
  return { sim, simRef, lastTickAt, metrics: sim.metrics, tick: sim.tick }
}

export const idempotency: TopicSpec<IdempotencyState, IdempotencySim, IdempotencyMetrics, Beat> = {
  chapters: CHAPTERS,
  useRuntime,
  sync: (sim, st) => sim.apply(st),
  Scene,
  Stats,
  Controls,
  feedback: () => ({ crash: false, rise: false }),
  dropCount: () => 0,
}
