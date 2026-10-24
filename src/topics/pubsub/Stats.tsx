import { ArrowIcon, Chip, CrossIcon, GaugeIcon, StackIcon } from '../../core/hud'
import type { PanelProps } from '../../core/types'
import { TEAMS, TEAM_NAMES } from './bus'
import type { BusMetrics, BusSim } from './engine'
import type { Beat, BusState } from './types'

export default function Stats({ beat, st, m }: PanelProps<BusState, BusSim, BusMetrics, Beat>) {
  const hud = new Set(beat.hud ?? [])
  return (
    <>
      {hud.has('missed') && <Chip icon={<CrossIcon />} title="Events missed" value={`${m.missed}`} bad={m.missed > 0} />}
      {hud.has('behind') &&
        TEAMS.filter((t) => st[t] > 0).map((t) => (
          <Chip key={t} icon={<StackIcon />} title={`${TEAM_NAMES[t]} behind`} value={`${m.behind[t]}`} bad={m.behind[t] >= 8} />
        ))}
      {hud.has('order') && <Chip icon={<GaugeIcon />} title="Out of order" value={`${m.disorder}`} bad={m.disorder > 0} />}
      {hud.has('lost') && <Chip icon={<CrossIcon />} title="Events lost" value={`${m.lost.stock}`} bad={m.lost.stock > 0} />}
      {hud.has('doubled') && <Chip icon={<CrossIcon />} title="Work done twice" value={`${m.duplicates}`} bad={m.duplicates > 0} />}
      {hud.has('doubled') && st.dedupe && <Chip icon={<ArrowIcon />} title="Repeats skipped" value={`${m.ignored}`} />}
      {hud.has('done') && <Chip icon={<ArrowIcon />} title="Events done" value={`${m.doneRate.toFixed(1)} /s`} />}
    </>
  )
}
