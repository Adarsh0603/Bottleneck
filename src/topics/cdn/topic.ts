import { useTicker } from '../../core/flow/useTicker'
import type { Runtime, TopicSpec } from '../../core/types'
import { CHAPTERS } from './chapters'
import Controls from './Controls'
import { CdnSim, type CdnMetrics } from './engine'
import Scene from './Scene'
import Stats from './Stats'
import type { Beat, CdnState } from './types'
import { TICKS_PER_SECOND } from './world'

function useRuntime(stRef: { current: CdnState }, paused: boolean): Runtime<CdnSim, CdnMetrics> {
  const { sim, simRef, lastTickAt } = useTicker(
    () => {
      const s = new CdnSim()
      s.apply(stRef.current)
      return s
    },
    TICKS_PER_SECOND,
    paused,
  )
  return { sim, simRef, lastTickAt, metrics: sim.metrics, tick: sim.tick }
}

const edgeCount = (st: CdnState) => Object.values(st.edges).filter(Boolean).length

export const cdn: TopicSpec<CdnState, CdnSim, CdnMetrics, Beat> = {
  chapters: CHAPTERS,
  useRuntime,
  sync: (sim, st) => sim.apply(st),
  Scene,
  Stats,
  Controls,
  feedback: (prev, next) => ({ crash: next.purge > prev.purge, rise: edgeCount(next) > edgeCount(prev) }),
  dropCount: (sim) => sim.flow.stats.dropped,
}
