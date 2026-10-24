import { Segmented, Stepper } from '../../core/controls'
import type { PanelProps } from '../../core/types'
import type { QueueMetrics, QueueSim } from './engine'
import type { Beat, QueueState } from './types'
import { MAX_WORKERS } from './world'

const QUEUE = [
  { value: 'direct', label: 'No queue' },
  { value: 'queue', label: 'Queue' },
]

const RETRIES = [
  { value: 0, label: 'No retries' },
  { value: 1, label: '1 retry' },
  { value: 2, label: '2 retries' },
  { value: 3, label: '3 retries' },
]

const DEAD_LETTER = [
  { value: 'off', label: 'No dead-letter box' },
  { value: 'on', label: 'Dead-letter box' },
]

export default function Controls({ beat, st, update }: PanelProps<QueueState, QueueSim, QueueMetrics, Beat>) {
  const controls = new Set(beat.controls ?? [])
  return (
    <>
      {controls.has('queue') && (
        <div className="mt-4">
          <Segmented value={st.queued ? 'queue' : 'direct'} options={QUEUE} onChange={(v) => update(() => ({ queued: v === 'queue' }))} />
        </div>
      )}
      {controls.has('workers') && (
        <div className="mt-4">
          <Stepper value={st.workers} min={1} max={MAX_WORKERS} label="worker" onChange={(v) => update(() => ({ workers: v }))} />
        </div>
      )}
      {controls.has('retries') && (
        <div className="mt-4">
          <Segmented value={st.retries} options={RETRIES} onChange={(v) => update(() => ({ retries: v }))} />
        </div>
      )}
      {controls.has('deadLetter') && (
        <div className="mt-4">
          <Segmented value={st.deadLetter ? 'on' : 'off'} options={DEAD_LETTER} onChange={(v) => update(() => ({ deadLetter: v === 'on' }))} />
        </div>
      )}
    </>
  )
}
