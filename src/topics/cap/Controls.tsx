import { Segmented } from '../../core/controls'
import type { PanelProps } from '../../core/types'
import type { CapMetrics, CapSim } from './engine'
import type { Beat, CapState, Mode } from './types'

const MODES: { value: Mode; label: string }[] = [
  { value: 'consistent', label: 'Consistent: refuse' },
  { value: 'available', label: 'Available: answer' },
]

const LINK: { value: 'up' | 'cut'; label: string }[] = [
  { value: 'up', label: 'Link up' },
  { value: 'cut', label: 'Link cut' },
]

export default function Controls({ beat, st, update }: PanelProps<CapState, CapSim, CapMetrics, Beat>) {
  const controls = new Set(beat.controls ?? [])
  return (
    <>
      {controls.has('partition') && (
        <div className="mt-4">
          <Segmented value={st.partitioned ? 'cut' : 'up'} options={LINK} onChange={(v) => update(() => ({ partitioned: v === 'cut' }))} />
        </div>
      )}
      {controls.has('mode') && (
        <div className="mt-4">
          <Segmented value={st.mode} options={MODES} onChange={(v) => update(() => ({ mode: v }))} />
        </div>
      )}
    </>
  )
}
