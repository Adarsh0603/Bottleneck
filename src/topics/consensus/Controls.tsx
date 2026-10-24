import { Segmented } from '../../core/controls'
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
