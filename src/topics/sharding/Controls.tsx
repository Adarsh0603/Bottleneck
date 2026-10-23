import { Segmented, Stepper } from '../../core/controls'
import type { PanelProps } from '../../core/types'
import type { ShardingMetrics, ShardingSim } from './engine'
import type { Beat, ShardingState, ShardKey } from './types'
import { MAX_SHARDS } from './world'

const KEYS: { value: ShardKey; label: string }[] = [
  { value: 'name', label: 'Name' },
  { value: 'signup', label: 'Signup order' },
  { value: 'hash', label: 'Hashed id' },
]

export default function Controls({ beat, st, update }: PanelProps<ShardingState, ShardingSim, ShardingMetrics, Beat>) {
  const controls = new Set(beat.controls ?? [])
  return (
    <>
      {controls.has('shards') && (
        <div className="mt-4">
          <Stepper value={st.shards} min={1} max={MAX_SHARDS} label="shard" onChange={(v) => update(() => ({ shards: v }))} />
        </div>
      )}
      {controls.has('key') && (
        <div className="mt-4">
          <Segmented value={st.key} options={KEYS} onChange={(v) => update(() => ({ key: v }))} />
        </div>
      )}
    </>
  )
}
