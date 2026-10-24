import { ArrowIcon, Chip, ClockIcon, CoinIcon, CrossIcon, StackIcon } from '../../core/hud'
import type { PanelProps } from '../../core/types'
import type { TransactionsMetrics, TransactionsSim } from './engine'
import type { Beat, TransactionsState } from './types'

export default function Stats({ beat, m }: PanelProps<TransactionsState, TransactionsSim, TransactionsMetrics, Beat>) {
  const hud = new Set(beat.hud ?? [])
  return (
    <>
      {hud.has('committed') && <Chip icon={<ArrowIcon />} title="Completed" value={`${m.committed}`} />}
      {hud.has('aborted') && <Chip icon={<StackIcon />} title="Cleanly cancelled" value={`${m.aborted}`} />}
      {hud.has('broken') && <Chip icon={<CrossIcon />} title="Half done" value={`${m.broken}`} bad={m.broken > 0} />}
      {hud.has('locked') && <Chip icon={<CoinIcon />} title="Locked services" value={`${m.locked}`} bad={m.locked > 0} />}
      {hud.has('stalled') && <Chip icon={<ClockIcon />} title="Waiting for a lock" value={`${m.stalled}`} bad={m.stalled > 0} />}
      {hud.has('doubles') && <Chip icon={<CrossIcon />} title="Done twice" value={`${m.doubles}`} bad={m.doubles > 0} />}
      {hud.has('undone') && <Chip icon={<StackIcon />} title="Steps undone" value={`${m.undone}`} />}
    </>
  )
}
