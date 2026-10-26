import { ArrowIcon, Chip, ClockIcon, GaugeIcon, StackIcon } from '../../core/hud'
import type { PanelProps } from '../../core/types'
import type { FanoutMetrics, FanoutSim } from './engine'
import type { Beat, FanoutState } from './types'

export default function Stats({ beat, m }: PanelProps<FanoutState, FanoutSim, FanoutMetrics, Beat>) {
  const hud = new Set(beat.hud ?? [])
  return (
    <>
      {hud.has('posted') && <Chip icon={<ArrowIcon />} title="Posts saved" value={`${m.posted}`} />}
      {hud.has('writes') && <Chip icon={<StackIcon />} title="Inbox writes" value={`${m.writes}`} />}
      {hud.has('backlog') && <Chip icon={<GaugeIcon />} title="Writes waiting" value={`${m.backlog}`} bad={m.backlog > 40} />}
      {hud.has('slowest') && <Chip icon={<ClockIcon />} title="Slowest delivery" value={m.delivered ? `${m.slowest.toFixed(1)}s` : '–'} bad={m.slowest > 4} />}
      {hud.has('opened') && <Chip icon={<ArrowIcon />} title="Feeds shown" value={`${m.opened}`} />}
      {hud.has('wait') && <Chip icon={<ClockIcon />} title="Last wait" value={m.opened ? `${m.lastWait.toFixed(1)}s` : '–'} bad={m.lastWait > 4} />}
      {hud.has('lookups') && <Chip icon={<StackIcon />} title="Lookups" value={`${m.lookups}`} />}
      {hud.has('queue') && <Chip icon={<GaugeIcon />} title="Store queue" value={`${m.queue}`} bad={m.queue > 10} />}
    </>
  )
}
