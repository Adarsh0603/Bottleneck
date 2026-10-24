import { Segmented, Stepper } from '../../core/controls'
import type { PanelProps } from '../../core/types'
import { MAX_CONSUMERS, MAX_PARTITIONS, type Commit, type KeyBy, type Mode } from './bus'
import type { BusMetrics, BusSim } from './engine'
import type { Beat, BusState } from './types'

const MODE: { value: Mode; label: string }[] = [
  { value: 'queue', label: 'Queue' },
  { value: 'topic', label: 'Topic' },
  { value: 'stream', label: 'Stream' },
]

const KEY: { value: KeyBy; label: string }[] = [
  { value: 'none', label: 'No key' },
  { value: 'order', label: 'Order id' },
  { value: 'product', label: 'Product' },
]

const RETENTION = [
  { value: 3, label: 'Keep 3 s' },
  { value: 30, label: 'Keep 30 s' },
]

const COMMIT: { value: Commit; label: string }[] = [
  { value: 'before', label: 'Commit before the work' },
  { value: 'after', label: 'Commit after the work' },
]

const DEDUPE = [
  { value: 'off', label: 'Repeat the work' },
  { value: 'on', label: 'Skip repeats' },
]

export default function Controls({ beat, st, update }: PanelProps<BusState, BusSim, BusMetrics, Beat>) {
  const controls = new Set(beat.controls ?? [])
  return (
    <>
      {controls.has('mode') && (
        <div className="mt-4">
          <Segmented value={st.mode} options={MODE} onChange={(v) => update(() => ({ mode: v }))} />
        </div>
      )}
      {controls.has('retention') && (
        <div className="mt-4">
          <Segmented value={st.retention} options={RETENTION} onChange={(v) => update(() => ({ retention: v }))} />
        </div>
      )}
      {controls.has('email') && (
        <div className="mt-4">
          <Stepper value={st.email} min={1} max={MAX_CONSUMERS.email} label="Email consumer" onChange={(v) => update(() => ({ email: v }))} />
        </div>
      )}
      {controls.has('stock') && (
        <div className="mt-4">
          <Stepper value={st.stock} min={1} max={MAX_CONSUMERS.stock} label="Inventory consumer" onChange={(v) => update(() => ({ stock: v }))} />
        </div>
      )}
      {controls.has('partitions') && (
        <div className="mt-4">
          <Stepper value={st.partitions} min={1} max={MAX_PARTITIONS} label="partition" onChange={(v) => update(() => ({ partitions: v }))} />
        </div>
      )}
      {controls.has('key') && (
        <div className="mt-4">
          <Segmented value={st.key} options={KEY} onChange={(v) => update(() => ({ key: v }))} />
        </div>
      )}
      {controls.has('commit') && (
        <div className="mt-4">
          <Segmented value={st.commit} options={COMMIT} onChange={(v) => update(() => ({ commit: v }))} />
        </div>
      )}
      {controls.has('dedupe') && (
        <div className="mt-4">
          <Segmented value={st.dedupe ? 'on' : 'off'} options={DEDUPE} onChange={(v) => update(() => ({ dedupe: v === 'on' }))} />
        </div>
      )}
    </>
  )
}
