import { ArrowIcon, Chip, ClockIcon, CrossIcon } from '../../core/hud'
import type { PanelProps } from '../../core/types'
import type { CachingMetrics, CachingSim } from './engine'
import type { Beat, CachingState, HudId } from './types'

export default function Stats({ beat, st, m }: PanelProps<CachingState, CachingSim, CachingMetrics, Beat>) {
  return (
    <>
      {(beat.hud ?? []).map((id) => (
        <Stat key={id} id={id} st={st} m={m} />
      ))}
    </>
  )
}

const iconProps = { width: 14, height: 14, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5 }

function TargetIcon() {
  return (
    <svg {...iconProps}>
      <circle cx="8" cy="8" r="6.5" />
      <circle cx="8" cy="8" r="2.5" />
    </svg>
  )
}

function DbIcon() {
  return (
    <svg {...iconProps}>
      <ellipse cx="8" cy="4" rx="5.5" ry="2" />
      <path d="M2.5 4v8c0 1.1 2.5 2 5.5 2s5.5-.9 5.5-2V4M2.5 8c0 1.1 2.5 2 5.5 2s5.5-.9 5.5-2" />
    </svg>
  )
}

function HourglassIcon() {
  return (
    <svg {...iconProps}>
      <path d="M4 2h8M4 14h8M5 2c0 4 6 4 6 6s-6 2-6 6M11 2c0 4-6 4-6 6s6 2 6 6" />
    </svg>
  )
}

function Stat({ id, st, m }: { id: HudId; st: CachingState; m: CachingMetrics }) {
  switch (id) {
    case 'traffic':
      return <Chip icon={<ArrowIcon />} title="Traffic" value={`${st.rps} req/s`} />
    case 'latency':
      return <Chip icon={<ClockIcon />} title="Response time" value={`${(m.avgMs / 1000).toFixed(1)}s`} bad={m.avgMs > 2500} />
    case 'hitrate':
      return (
        <Chip icon={<TargetIcon />} title="Hit rate" value={Number.isNaN(m.hitRate) ? '—' : `${Math.round(m.hitRate * 100)}%`} />
      )
    case 'dbload':
      return <Chip icon={<DbIcon />} title="Database busy" value={`${Math.round(m.dbLoad * 100)}%`} bad={m.dbLoad > 0.75} />
    case 'errors':
      return <Chip icon={<CrossIcon />} title="Errors" value={`${m.dropRate.toFixed(0)}%`} bad={m.dropRate > 1} />
    case 'stale':
      return (
        <Chip
          icon={<CrossIcon />}
          title="Stale answers"
          value={Number.isNaN(m.staleRate) ? '—' : `${Math.round(m.staleRate)}%`}
          bad={m.staleRate >= 15}
        />
      )
    case 'age':
      return <Chip icon={<HourglassIcon />} title="Data can be" value={st.ttl > 0 ? `≤ ${st.ttl}s old` : 'any age'} />
  }
}
