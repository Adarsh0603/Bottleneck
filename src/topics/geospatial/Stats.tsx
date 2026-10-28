import { ArrowIcon, Chip, ClockIcon, CrossIcon, GaugeIcon, StackIcon } from '../../core/hud'
import type { PanelProps } from '../../core/types'
import type { GeoMetrics, GeoSim, Outcome } from './engine'
import type { Beat, GeoState } from './types'

const ANSWER: Record<Outcome, string> = { right: 'Nearest car', wrong: 'Not the nearest', none: 'No car found' }

const ms = (n: number) => (n < 10 ? `${n.toFixed(1)} ms` : `${Math.round(n).toLocaleString()} ms`)

export default function Stats({ beat, st, m }: PanelProps<GeoState, GeoSim, GeoMetrics, Beat>) {
  const hud = new Set(beat.hud ?? [])
  return (
    <>
      {hud.has('checked') && <Chip icon={<StackIcon />} title="Cars checked" value={m.lookups ? m.checked.toLocaleString() : '–'} bad={m.checked > 1000} />}
      {hud.has('time') && <Chip icon={<ClockIcon />} title="Lookup time" value={m.lookups ? ms(m.ms) : '–'} bad={m.ms >= 100} />}
      {hud.has('result') && <Chip icon={<ArrowIcon />} title="Answer" value={m.outcome ? ANSWER[m.outcome] : '–'} bad={m.outcome === 'wrong' || m.outcome === 'none'} />}
      {hud.has('cells') && <Chip icon={<GaugeIcon />} title={st.method === 'quadtree' ? 'Boxes read' : 'Cells read'} value={m.lookups ? `${m.cells}` : '–'} />}
      {hud.has('widened') && <Chip icon={<ArrowIcon />} title="Letters dropped" value={m.lookups ? `${m.widened}` : '–'} />}
      {hud.has('misses') && <Chip icon={<CrossIcon />} title="Wrong or empty" value={`${m.misses} of ${m.lookups}`} bad={m.misses > 0} />}
      {hud.has('load') && <Chip icon={<GaugeIcon />} title="Cars checked a second" value={Math.round(m.load).toLocaleString()} bad={m.load >= 300} />}
    </>
  )
}
