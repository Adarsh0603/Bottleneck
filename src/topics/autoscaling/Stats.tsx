import { ArrowIcon, Chip, ClockIcon, CoinIcon, CrossIcon, GaugeIcon, StackIcon } from '../../core/hud'
import type { PanelProps } from '../../core/types'
import type { AutoscaleMetrics, AutoscaleSim } from './engine'
import type { AutoscaleState, Beat } from './types'

export default function Stats({ beat, m }: PanelProps<AutoscaleState, AutoscaleSim, AutoscaleMetrics, Beat>) {
  const hud = new Set(beat.hud ?? [])
  return (
    <>
      {hud.has('clock') && <Chip icon={<ClockIcon />} title="Time" value={`${String(Math.floor(m.hour)).padStart(2, '0')}:00`} />}
      {hud.has('traffic') && <Chip icon={<ArrowIcon />} title="Traffic" value={`${m.rps.toFixed(1)} req/s`} />}
      {hud.has('servers') && (
        <Chip icon={<StackIcon />} title="Servers" value={m.booting > 0 ? `${m.running} +${m.booting} booting` : `${m.running}`} />
      )}
      {hud.has('busy') && <Chip icon={<GaugeIcon />} title="Busy" value={`${Math.round(m.busy * 100)}%`} />}
      {hud.has('cost') && <Chip icon={<CoinIcon />} title="Cost" value={`$${m.cost}/mo`} />}
      {hud.has('errors') && <Chip icon={<CrossIcon />} title="Errors" value={`${m.dropRate.toFixed(1)}%`} bad={m.dropRate > 1} />}
    </>
  )
}
