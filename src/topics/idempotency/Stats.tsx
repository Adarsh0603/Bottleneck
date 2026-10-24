import { ArrowIcon, Chip, ClockIcon, CoinIcon, CrossIcon, StackIcon } from '../../core/hud'
import type { PanelProps } from '../../core/types'
import type { IdempotencyMetrics, IdempotencySim } from './engine'
import type { Beat, IdempotencyState } from './types'

export default function Stats({ beat, m, st }: PanelProps<IdempotencyState, IdempotencySim, IdempotencyMetrics, Beat>) {
  const hud = new Set(beat.hud ?? [])
  const queue = st.sender === 'queue'
  return (
    <>
      {hud.has('paid') && <Chip icon={<ArrowIcon />} title={queue ? 'Acknowledged' : 'Told paid'} value={`${m.paid}`} />}
      {hud.has('charges') && <Chip icon={<CoinIcon />} title={queue ? 'Applied' : 'Charges in ledger'} value={`${m.charges}`} />}
      {hud.has('dupes') && <Chip icon={<CrossIcon />} title={queue ? 'Applied twice' : 'Charged twice'} value={`${m.dupes}`} bad={m.dupes > 0} />}
      {hud.has('waiting') && <Chip icon={<ClockIcon />} title="Waiting" value={`${m.waiting}`} bad={m.waiting > 2} />}
      {hud.has('retries') && <Chip icon={<StackIcon />} title={queue ? 'Redeliveries' : 'Retries'} value={`${m.retries}`} />}
      {hud.has('replays') && <Chip icon={<StackIcon />} title="Saved answers sent" value={`${m.replays}`} />}
    </>
  )
}
