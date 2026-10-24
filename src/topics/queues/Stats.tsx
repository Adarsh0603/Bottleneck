import { ArrowIcon, Chip, ClockIcon, CrossIcon, GaugeIcon, StackIcon } from '../../core/hud'
import type { PanelProps } from '../../core/types'
import type { QueueMetrics, QueueSim } from './engine'
import type { Beat, QueueState } from './types'
import { HOT } from './world'

const pct = (n: number) => (Number.isNaN(n) ? '—' : `${n < 10 && n > 0 ? n.toFixed(1) : Math.round(n)}%`)
const secs = (n: number) => (Number.isNaN(n) ? '—' : `${n.toFixed(1)}s`)

export default function Stats({ beat, sim, m }: PanelProps<QueueState, QueueSim, QueueMetrics, Beat>) {
  const hud = new Set(beat.hud ?? [])
  return (
    <>
      {hud.has('response') && <Chip icon={<ClockIcon />} title="User waits" value={secs(m.responseSeconds)} bad={m.responseSeconds >= 1} />}
      {hud.has('errors') && <Chip icon={<CrossIcon />} title="Turned away" value={pct(m.errorRate)} bad={m.errorRate >= 1} />}
      {hud.has('backlog') && <Chip icon={<StackIcon />} title="Waiting" value={`${m.backlog}`} bad={m.backlog >= sim.fifo.capacity * 0.5} />}
      {hud.has('wait') && <Chip icon={<ClockIcon />} title="Oldest job waited" value={secs(m.waitSeconds)} bad={m.waitSeconds >= 3} />}
      {hud.has('done') && <Chip icon={<ArrowIcon />} title="Jobs done" value={`${m.doneRate.toFixed(1)} /s`} />}
      {hud.has('load') && <Chip icon={<GaugeIcon />} title="Workers busy" value={pct(m.load * 100)} bad={m.load > HOT} />}
      {hud.has('lost') && <Chip icon={<CrossIcon />} title="Jobs lost" value={`${sim.lost}`} bad={sim.lost > 0} />}
      {hud.has('stuck') && <Chip icon={<CrossIcon />} title="Parked, could have worked" value={`${sim.stuck}`} bad={sim.stuck > 0} />}
    </>
  )
}
