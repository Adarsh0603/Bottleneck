import { ArrowIcon, Chip, ClockIcon, CrossIcon, StackIcon } from '../../core/hud'
import type { PanelProps } from '../../core/types'
import type { ConsensusMetrics, ConsensusSim } from './engine'
import type { Beat, ConsensusState } from './types'

export default function Stats({ beat, m }: PanelProps<ConsensusState, ConsensusSim, ConsensusMetrics, Beat>) {
  const hud = new Set(beat.hud ?? [])
  return (
    <>
      {hud.has('confirmed') && <Chip icon={<ArrowIcon />} title="Seats confirmed" value={`${m.confirmed}`} />}
      {hud.has('clashes') && <Chip icon={<CrossIcon />} title="Sold twice" value={`${m.clashTotal}`} bad={m.clashTotal > 0} />}
      {hud.has('leader') && <Chip icon={<StackIcon />} title="Leader" value={m.leader === null ? 'None' : `Server ${m.leader + 1}`} bad={m.leader === null} />}
      {hud.has('term') && <Chip icon={<ClockIcon />} title="Term" value={`${m.term}`} />}
      {hud.has('holders') && <Chip icon={<StackIcon />} title="Servers holding it" value={`${m.holders} of ${m.size}`} bad={m.holders <= m.size / 2} />}
      {hud.has('waiting') && <Chip icon={<ClockIcon />} title="Waiting" value={`${m.waiting}`} bad={m.waiting > 2} />}
      {hud.has('stall') && <Chip icon={<ClockIcon />} title="No leader for" value={`${Math.floor(m.stall)} s`} bad={m.stall > 0.5} />}
    </>
  )
}
