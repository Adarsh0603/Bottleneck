import { ArrowIcon, Chip, ClockIcon, CrossIcon, GaugeIcon, StackIcon } from '../../core/hud'
import type { PanelProps } from '../../core/types'
import type { ShopMetrics, ShopSim } from './engine'
import type { Beat, ShopState } from './types'

export default function Stats({ beat, m }: PanelProps<ShopState, ShopSim, ShopMetrics, Beat>) {
  const hud = new Set(beat.hud ?? [])
  return (
    <>
      {hud.has('browse') && <Chip icon={<CrossIcon />} title="Pages failed" value={`${m.browseFailed}`} bad={m.browseFailed > 0} />}
      {hud.has('checkout') && <Chip icon={<CrossIcon />} title="Checkouts failed" value={`${m.checkoutFailed}`} bad={m.checkoutFailed > 0} />}
      {hud.has('threads') && <Chip icon={<StackIcon />} title="Threads busy" value={`${m.threadsBusy} / ${m.threads}`} bad={m.threadsBusy >= m.threads} />}
      {hud.has('wait') && <Chip icon={<ClockIcon />} title="Customers wait" value={`${(m.waitMs / 1000).toFixed(1)} s`} bad={m.waitMs > 1500} />}
      {hud.has('load') && <Chip icon={<GaugeIcon />} title="Payments load" value={`${m.payRate} / second`} bad={m.payOverloaded > 0} />}
      {hud.has('shed') && <Chip icon={<ArrowIcon />} title="Failed at once" value={`${m.shed}`} />}
    </>
  )
}
