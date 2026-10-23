import { ArrowIcon, Chip, ClockIcon, GaugeIcon } from '../../core/hud'
import type { PanelProps } from '../../core/types'
import type { CdnMetrics, CdnSim } from './engine'
import type { Beat, CdnState } from './types'
import { REGIONS, SLOW_MS } from './world'

export default function Stats({ beat, st, m }: PanelProps<CdnState, CdnSim, CdnMetrics, Beat>) {
  const hud = new Set(beat.hud ?? [])
  return (
    <>
      {hud.has('latency') &&
        REGIONS.map((r) => {
          const ms = m.latency[r.id]
          return <Chip key={r.id} icon={<ClockIcon />} title={r.name} value={ms ? `${(ms / 1000).toFixed(2)}s` : '—'} bad={ms > SLOW_MS} />
        })}
      {hud.has('hitrate') && (
        <Chip icon={<GaugeIcon />} title="Edge hit rate" value={Number.isNaN(m.hitRate) ? '—' : `${Math.round(m.hitRate * 100)}%`} />
      )}
      {hud.has('origin') && <Chip icon={<ArrowIcon />} title="Reaching origin" value={`${m.originRps.toFixed(1)} req/s`} />}
      {hud.has('edges') && (
        <Chip icon={<GaugeIcon />} title="Edges" value={`${Object.values(st.edges).filter(Boolean).length} / 2 allowed`} bad={Object.values(st.edges).filter(Boolean).length > 2} />
      )}
    </>
  )
}
