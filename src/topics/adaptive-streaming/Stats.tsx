import { ArrowIcon, Chip, ClockIcon, CrossIcon, GaugeIcon, StackIcon } from '../../core/hud'
import type { PanelProps } from '../../core/types'
import { RUNGS, type StreamMetrics, type StreamSim } from './engine'
import type { Beat, StreamState } from './types'

const secs = (n: number) => `${n.toFixed(1)} s`

export default function Stats({ beat, m }: PanelProps<StreamState, StreamSim, StreamMetrics, Beat>) {
  const hud = new Set(beat.hud ?? [])
  return (
    <>
      {hud.has('speed') && <Chip icon={<GaugeIcon />} title="Connection" value={`${m.speed.toFixed(1)} Mbps`} />}
      {hud.has('buffer') && <Chip icon={<StackIcon />} title="Buffer" value={secs(m.buffer)} bad={m.frozen} />}
      {hud.has('picture') && <Chip icon={<ArrowIcon />} title="Picture" value={m.shown >= 0 ? RUNGS[m.shown].label : '–'} />}
      {hud.has('stalls') && <Chip icon={<CrossIcon />} title="Freezes" value={`${m.stalls}`} bad={m.stalls > 0} />}
      {hud.has('stalled') && <Chip icon={<ClockIcon />} title="Time frozen" value={secs(m.stalled)} bad={m.stalled > 0} />}
      {hud.has('switches') && <Chip icon={<ArrowIcon />} title="Quality changes" value={`${m.switches}`} bad={m.switches > 8} />}
      {hud.has('start') && <Chip icon={<ClockIcon />} title="Time to first frame" value={m.start >= 0 ? secs(m.start) : '…'} bad={m.start > 3} />}
      {hud.has('average') && <Chip icon={<GaugeIcon />} title="Average picture" value={m.average > 0 ? `${m.average.toFixed(1)} Mbps` : '–'} />}
    </>
  )
}
