import { ArrowIcon, Chip, CrossIcon, GaugeIcon, StackIcon } from '../../core/hud'
import type { PanelProps } from '../../core/types'
import type { ShardingMetrics, ShardingSim } from './engine'
import type { Beat, ShardingState } from './types'
import { HOT } from './world'

const pct = (n: number) => (Number.isNaN(n) ? '—' : `${n < 10 && n > 0 ? n.toFixed(1) : Math.round(n)}%`)

export default function Stats({ beat, st, m }: PanelProps<ShardingState, ShardingSim, ShardingMetrics, Beat>) {
  const hud = new Set(beat.hud ?? [])
  const one = st.shards === 1
  return (
    <>
      {hud.has('traffic') && <Chip icon={<ArrowIcon />} title="Traffic" value={`${m.rps.toFixed(1)} /s`} />}
      {hud.has('shards') && <Chip icon={<StackIcon />} title="Shards" value={`${st.shards}`} />}
      {hud.has('load') && <Chip icon={<GaugeIcon />} title={one ? 'Database busy' : 'Busiest shard'} value={pct(m.maxLoad * 100)} bad={m.maxLoad > HOT} />}
      {hud.has('spread') && (
        <>
          <Chip icon={<GaugeIcon />} title="Busiest shard" value={pct(m.maxLoad * 100)} bad={m.maxLoad > HOT} />
          <Chip icon={<GaugeIcon />} title="Quietest shard" value={pct(m.minLoad * 100)} />
        </>
      )}
      {hud.has('errors') && <Chip icon={<CrossIcon />} title="Errors" value={pct(m.errorRate)} bad={m.errorRate >= 1} />}
    </>
  )
}
