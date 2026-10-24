import { Segmented, Slider } from '../../core/controls'
import type { PanelProps } from '../../core/types'
import type { ConsensusMetrics, ConsensusSim } from './engine'
import type { Beat, ConsensusState, Rule } from './types'

const RULES: { value: Rule; label: string }[] = [
  { value: 'anyone', label: 'Any server confirms' },
  { value: 'leader', label: 'Only the leader confirms' },
]

const LEADER: { value: 'up' | 'down'; label: string }[] = [
  { value: 'up', label: 'Leader running' },
  { value: 'down', label: 'Leader crashed' },
]

const SPLIT: { value: number; label: string }[] = [
  { value: 0, label: 'Network healthy' },
  { value: 2, label: 'Network split' },
]

const Row = ({ children }: { children: React.ReactNode }) => <div className="mt-4">{children}</div>

export default function Controls({ beat, st, sim, update }: PanelProps<ConsensusState, ConsensusSim, ConsensusMetrics, Beat>) {
  const controls = new Set(beat.controls ?? [])
  return (
    <>
      {controls.has('rule') && (
        <Row>
          <Segmented scroll value={st.rule} options={RULES} onChange={(v) => update(() => ({ rule: v }))} />
        </Row>
      )}
      {controls.has('split') && (
        <Row>
          <Segmented value={st.split} options={SPLIT} onChange={(v) => update(() => ({ split: v }))} />
        </Row>
      )}
      {controls.has('spread') && (
        <Row>
          <Slider
            label="Timer randomness"
            value={st.spread}
            min={0}
            max={6}
            unit="s"
            hint="How much longer each follower may wait before calling an election. At 0 every timer is the same."
            onChange={(v) => update(() => ({ spread: v }))}
          />
        </Row>
      )}
      {controls.has('crash') && (
        <Row>
          <Segmented
            value={st.down.length ? 'down' : 'up'}
            options={LEADER}
            onChange={(v) => update(() => ({ down: v === 'down' ? [sim.leader?.id ?? 0] : [] }))}
          />
        </Row>
      )}
    </>
  )
}
