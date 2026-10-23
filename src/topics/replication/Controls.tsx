import { Segmented, Stepper } from '../../core/controls'
import type { PanelProps } from '../../core/types'
import type { ReplicationMetrics, ReplicationSim } from './engine'
import type { Beat, ReadFrom, ReplicationState } from './types'
import { MAX_REPLICAS } from './world'

const READ_FROM: { value: ReadFrom; label: string }[] = [
  { value: 'replicas', label: 'All reads → replicas' },
  { value: 'own', label: 'Your own writes → primary' },
  { value: 'primary', label: 'All reads → primary' },
]

export default function Controls({ beat, st, update }: PanelProps<ReplicationState, ReplicationSim, ReplicationMetrics, Beat>) {
  const controls = new Set(beat.controls ?? [])
  return (
    <>
      {controls.has('replicas') && (
        <div className="mt-4">
          <Stepper value={st.replicas} min={0} max={MAX_REPLICAS} label="replica" onChange={(v) => update(() => ({ replicas: v }))} />
        </div>
      )}
      {controls.has('readFrom') && (
        <div className="mt-4">
          <Segmented value={st.readFrom} options={READ_FROM} onChange={(v) => update(() => ({ readFrom: v }))} />
        </div>
      )}
    </>
  )
}
