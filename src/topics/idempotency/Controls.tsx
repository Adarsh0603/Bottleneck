import { Segmented } from '../../core/controls'
import type { PanelProps } from '../../core/types'
import type { IdempotencyMetrics, IdempotencySim } from './engine'
import type { Beat, IdempotencyState, Keys, Lose, Op } from './types'

const FAULTS: { value: Lose; label: string }[] = [
  { value: 'none', label: 'Network healthy' },
  { value: 'request', label: 'Request lost' },
  { value: 'reply', label: 'Reply lost' },
]

const OPS: { value: Op; label: string }[] = [
  { value: 'add', label: 'Add a charge' },
  { value: 'set', label: 'Set order to paid' },
]

const KEYS: { value: Keys; label: string }[] = [
  { value: 'none', label: 'No key' },
  { value: 'check', label: 'Check, then charge' },
  { value: 'atomic', label: 'Claim key first' },
]

const TOGETHER: { value: 'apart' | 'together'; label: string }[] = [
  { value: 'apart', label: 'Charge, then save key' },
  { value: 'together', label: 'Save both together' },
]

const RETRY: { value: 'on' | 'off'; label: string }[] = [
  { value: 'on', label: 'Retries' },
  { value: 'off', label: 'Never retries' },
]

const Row = ({ children }: { children: React.ReactNode }) => <div className="mt-4">{children}</div>

export default function Controls({ beat, st, update }: PanelProps<IdempotencyState, IdempotencySim, IdempotencyMetrics, Beat>) {
  const controls = new Set(beat.controls ?? [])
  return (
    <>
      {controls.has('pay') && (
        <Row>
          <button
            onClick={() => update((prev) => ({ tap: prev.tap + 1 }))}
            className="rounded-xl bg-fg px-5 py-2 text-sm font-medium text-bg transition hover:opacity-90"
          >
            {st.sender === 'queue' ? 'Send a message' : st.double ? 'Double-tap Pay' : 'Tap Pay'}
          </button>
        </Row>
      )}
      {controls.has('faults') && (
        <Row>
          <Segmented scroll value={st.lose} options={FAULTS} onChange={(v) => update(() => ({ lose: v }))} />
        </Row>
      )}
      {controls.has('retry') && (
        <Row>
          <Segmented value={st.retry ? 'on' : 'off'} options={RETRY} onChange={(v) => update(() => ({ retry: v === 'on' }))} />
        </Row>
      )}
      {controls.has('op') && (
        <Row>
          <Segmented scroll value={st.op} options={OPS} onChange={(v) => update(() => ({ op: v }))} />
        </Row>
      )}
      {controls.has('keys') && (
        <Row>
          <Segmented scroll value={st.keys} options={KEYS} onChange={(v) => update(() => ({ keys: v }))} />
        </Row>
      )}
      {controls.has('together') && (
        <Row>
          <Segmented scroll value={st.together ? 'together' : 'apart'} options={TOGETHER} onChange={(v) => update(() => ({ together: v === 'together' }))} />
        </Row>
      )}
    </>
  )
}
