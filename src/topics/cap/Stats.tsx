import { ArrowIcon, Chip, ClockIcon, CrossIcon, StackIcon } from '../../core/hud'
import type { PanelProps } from '../../core/types'
import type { CapMetrics, CapSim } from './engine'
import type { Beat, CapState } from './types'

const pct = (n: number) => (Number.isNaN(n) ? '—' : `${n < 10 && n > 0 ? n.toFixed(1) : Math.round(n)}%`)

export default function Stats({ beat, st, m }: PanelProps<CapState, CapSim, CapMetrics, Beat>) {
  const hud = new Set(beat.hud ?? [])
  return (
    <>
      {hud.has('mix') && (
        <>
          <Chip icon={<ArrowIcon />} title="Reads" value={`${m.readsPerSec.toFixed(1)} /s`} />
          <Chip icon={<ArrowIcon />} title="Writes" value={`${m.writesPerSec.toFixed(1)} /s`} />
        </>
      )}
      {hud.has('link') && <Chip icon={<StackIcon />} title="Link" value={st.partitioned ? 'Cut' : 'Up'} bad={st.partitioned} />}
      {hud.has('errors') && <Chip icon={<CrossIcon />} title="East turned away" value={pct(m.eastErrorRate)} bad={m.eastErrorRate >= 1} />}
      {hud.has('stale') && <Chip icon={<ClockIcon />} title="East old data" value={pct(m.eastStaleRate)} bad={m.eastStaleRate > 0} />}
      {hud.has('conflicts') && <Chip icon={<CrossIcon />} title="Conflicts" value={`${m.conflicts}`} bad={m.conflicts > 0} />}
    </>
  )
}
