import { ArrowIcon, Chip, ClockIcon, CrossIcon, GaugeIcon, StackIcon } from '../../core/hud'
import type { PanelProps } from '../../core/types'
import type { RealtimeMetrics, RealtimeSim } from './engine'
import type { Beat, RealtimeState } from './types'

export default function Stats({ beat, m }: PanelProps<RealtimeState, RealtimeSim, RealtimeMetrics, Beat>) {
  const hud = new Set(beat.hud ?? [])
  return (
    <>
      {hud.has('shown') && <Chip icon={<ArrowIcon />} title="Messages shown" value={`${m.shown}`} />}
      {hud.has('delay') && <Chip icon={<ClockIcon />} title="Last delay" value={m.shown ? `${m.lastDelay.toFixed(1)}s` : '–'} bad={m.lastDelay > 3} />}
      {hud.has('requests') && <Chip icon={<StackIcon />} title="Requests" value={`${m.requests}`} />}
      {hud.has('empty') && <Chip icon={<CrossIcon />} title="Empty answers" value={`${m.empty}`} bad={m.empty > 5} />}
      {hud.has('sent') && <Chip icon={<ArrowIcon />} title="Replies sent" value={`${m.sent}`} />}
      {hud.has('connected') && <Chip icon={<GaugeIcon />} title="Connected" value={`${m.connected.toLocaleString()} of ${m.cap.toLocaleString()}`} />}
      {hud.has('dead') && <Chip icon={<CrossIcon />} title="Dead connections" value={`${m.dead.toLocaleString()}`} bad={m.dead > m.cap * 0.1} />}
      {hud.has('waiting') && <Chip icon={<ClockIcon />} title="Phones waiting" value={`${m.waiting.toLocaleString()}`} bad={m.waiting > 0} />}
    </>
  )
}
