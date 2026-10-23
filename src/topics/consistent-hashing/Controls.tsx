import { Segmented, Stepper } from '../../core/controls'
import type { PanelProps } from '../../core/types'
import type { ConsistentMetrics, ConsistentSim } from './engine'
import { MAX_NODES, MAX_POINTS, type Mode } from './ring'
import type { Beat, ConsistentState } from './types'

const MODES: { value: Mode; label: string }[] = [
  { value: 'mod', label: 'Hash % N' },
  { value: 'ring', label: 'Hash ring' },
]

export default function Controls({ beat, st, update }: PanelProps<ConsistentState, ConsistentSim, ConsistentMetrics, Beat>) {
  const controls = new Set(beat.controls ?? [])
  return (
    <>
      {controls.has('mode') && (
        <div className="mt-4">
          <Segmented value={st.mode} options={MODES} onChange={(v) => update(() => ({ mode: v }))} />
        </div>
      )}
      {controls.has('nodes') && (
        <div className="mt-4">
          <Stepper value={st.nodes} min={2} max={MAX_NODES} label="server" onChange={(v) => update(() => ({ nodes: v }))} />
        </div>
      )}
      {controls.has('points') && (
        <div className="mt-4">
          <Stepper value={st.points} min={1} max={MAX_POINTS} label="virtual nodes per server" onChange={(v) => update(() => ({ points: v }))} />
        </div>
      )}
    </>
  )
}
