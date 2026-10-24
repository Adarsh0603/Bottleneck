import { useTicker } from '../../core/flow/useTicker'
import type { Runtime, TopicSpec } from '../../core/types'
import { CHAPTERS } from './chapters'
import Controls from './Controls'
import { TransactionsSim, type TransactionsMetrics } from './engine'
import Scene from './Scene'
import Stats from './Stats'
import type { Beat, TransactionsState } from './types'
import { TICKS_PER_SECOND } from './world'

function useRuntime(stRef: { current: TransactionsState }, paused: boolean): Runtime<TransactionsSim, TransactionsMetrics> {
  const { sim, simRef, lastTickAt } = useTicker(
    () => {
      const s = new TransactionsSim()
      s.apply(stRef.current)
      return s
    },
    TICKS_PER_SECOND,
    paused,
  )
  return { sim, simRef, lastTickAt, metrics: sim.metrics, tick: sim.tick }
}

export const transactions: TopicSpec<TransactionsState, TransactionsSim, TransactionsMetrics, Beat> = {
  chapters: CHAPTERS,
  useRuntime,
  sync: (sim, st) => sim.apply(st),
  Scene,
  Stats,
  Controls,
  feedback: () => ({ crash: false, rise: false }),
  dropCount: () => 0,
}
