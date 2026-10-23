import { ArrowIcon, Chip, CrossIcon, GaugeIcon, StackIcon } from '../../core/hud'
import type { PanelProps } from '../../core/types'
import type { ConsistentMetrics, ConsistentSim } from './engine'
import type { Beat, ConsistentState } from './types'
import { HOT } from './world'

const pct = (n: number) => (Number.isNaN(n) ? '—' : `${n < 10 && n > 0 ? n.toFixed(1) : Math.round(n)}%`)

export default function Stats({ beat, st, m }: PanelProps<ConsistentState, ConsistentSim, ConsistentMetrics, Beat>) {
  const hud = new Set(beat.hud ?? [])
  return (
    <>
      {hud.has('traffic') && <Chip icon={<ArrowIcon />} title="Traffic" value={`${m.rps.toFixed(1)} /s`} />}
      {hud.has('servers') && <Chip icon={<StackIcon />} title="Servers" value={`${st.nodes}`} />}
      {hud.has('moved') && <Chip icon={<StackIcon />} title="Items moved" value={pct(m.moved * 100)} bad={m.moved > 0.5} />}
      {hud.has('db') && <Chip icon={<GaugeIcon />} title="Database busy" value={pct(m.dbLoad * 100)} bad={m.dbLoad > HOT} />}
      {hud.has('spread') && (
        <>
          <Chip icon={<GaugeIcon />} title="Busiest server" value={pct(m.maxLoad * 100)} bad={m.maxLoad > HOT} />
          <Chip icon={<GaugeIcon />} title="Quietest server" value={pct(m.minLoad * 100)} />
        </>
      )}
      {hud.has('errors') && <Chip icon={<CrossIcon />} title="Errors" value={pct(m.errorRate)} bad={m.errorRate >= 1} />}
    </>
  )
}
