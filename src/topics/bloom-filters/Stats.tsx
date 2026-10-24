import { ArrowIcon, Chip, ClockIcon, CrossIcon, GaugeIcon, StackIcon } from '../../core/hud'
import type { PanelProps } from '../../core/types'
import type { BloomMetrics, BloomSim } from './engine'
import type { Beat, BloomState } from './types'

export default function Stats({ beat, m }: PanelProps<BloomState, BloomSim, BloomMetrics, Beat>) {
  const hud = new Set(beat.hud ?? [])
  return (
    <>
      {hud.has('asked') && <Chip icon={<ArrowIcon />} title="Names checked" value={`${m.asked}`} />}
      {hud.has('trips') && <Chip icon={<ClockIcon />} title="Database trips" value={`${m.trips}`} />}
      {hud.has('skipped') && <Chip icon={<StackIcon />} title="Answered by filter" value={`${m.skipped}`} />}
      {hud.has('wasted') && <Chip icon={<CrossIcon />} title="Wasted trips" value={`${m.wasted}`} bad={m.wasted > 3} />}
      {hud.has('waiting') && <Chip icon={<ClockIcon />} title="Waiting" value={`${m.waiting}`} bad={m.waiting > 4} />}
      {hud.has('wrong') && <Chip icon={<CrossIcon />} title="Wrongly told free" value={`${m.wrong}`} bad={m.wrong > 0} />}
      {hud.has('fill') && <Chip icon={<GaugeIcon />} title="Switches on" value={`${m.fillPct}%`} bad={m.fillPct > 60} />}
      {hud.has('fp') && <Chip icon={<GaugeIcon />} title="False “maybe” chance" value={`${m.fpPct}%`} bad={m.fpPct > 20} />}
    </>
  )
}
