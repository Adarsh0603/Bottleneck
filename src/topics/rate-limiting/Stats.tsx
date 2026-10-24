import { ArrowIcon, Chip, ClockIcon, CrossIcon, GaugeIcon } from '../../core/hud'
import type { PanelProps } from '../../core/types'
import type { RateMetrics, RateSim } from './engine'
import type { Beat, RateState } from './types'

export default function Stats({ beat, m }: PanelProps<RateState, RateSim, RateMetrics, Beat>) {
  const hud = new Set(beat.hud ?? [])
  return (
    <>
      {hud.has('ann') && <Chip icon={<CrossIcon />} title="A turned away" value={`${m.rejected.ann}`} bad={m.rejected.ann > 0} />}
      {hud.has('rejected') && <Chip icon={<CrossIcon />} title="Turned away (429)" value={`${m.rejectedTotal}`} />}
      {hud.has('overload') && <Chip icon={<GaugeIcon />} title="API overloaded" value={`${m.overload}`} bad={m.overload > 0} />}
      {hud.has('bot') && <Chip icon={<ArrowIcon />} title="Bot allowed" value={`${m.botRate.toFixed(1)} /s`} />}
      {hud.has('wait') && <Chip icon={<ClockIcon />} title="Added wait" value={`${Math.round(m.waitMs)} ms`} />}
    </>
  )
}
