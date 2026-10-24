import { Segmented } from '../../core/controls'
import type { PanelProps } from '../../core/types'
import type { TransactionsMetrics, TransactionsSim } from './engine'
import type { Beat, Fail, Mode, TransactionsState } from './types'

const MODES: { value: Mode; label: string }[] = [
  { value: 'naive', label: 'Just ask each' },
  { value: '2pc', label: 'Two-phase commit' },
  { value: 'saga', label: 'Saga' },
]

const FAILS: { value: Fail; label: string }[] = [
  { value: 'none', label: 'All healthy' },
  { value: 'stock', label: 'Stock refuses' },
  { value: 'pay', label: 'Payment refuses' },
  { value: 'ship', label: 'Shipping refuses' },
]

const CRASH: { value: 'on' | 'off'; label: string }[] = [
  { value: 'off', label: 'Orders stable' },
  { value: 'on', label: 'Orders crashes' },
]

const LOG: { value: 'on' | 'off'; label: string }[] = [
  { value: 'off', label: 'No progress log' },
  { value: 'on', label: 'Write progress down' },
]

const KEYS: { value: 'on' | 'off'; label: string }[] = [
  { value: 'off', label: 'Repeats run again' },
  { value: 'on', label: 'Repeats ignored (keys)' },
]

const Row = ({ children }: { children: React.ReactNode }) => <div className="mt-4">{children}</div>

export default function Controls({ beat, st, update }: PanelProps<TransactionsState, TransactionsSim, TransactionsMetrics, Beat>) {
  const controls = new Set(beat.controls ?? [])
  return (
    <>
      {controls.has('order') && (
        <Row>
          <button
            onClick={() => update((prev) => ({ tap: prev.tap + 1 }))}
            className="rounded-xl bg-fg px-5 py-2 text-sm font-medium text-bg transition hover:opacity-90"
          >
            Place an order
          </button>
        </Row>
      )}
      {controls.has('mode') && (
        <Row>
          <Segmented scroll value={st.mode} options={MODES} onChange={(v) => update(() => ({ mode: v }))} />
        </Row>
      )}
      {controls.has('fail') && (
        <Row>
          <Segmented scroll value={st.fail} options={FAILS} onChange={(v) => update(() => ({ fail: v }))} />
        </Row>
      )}
      {controls.has('crash') && (
        <Row>
          <Segmented value={st.crash ? 'on' : 'off'} options={CRASH} onChange={(v) => update(() => ({ crash: v === 'on' }))} />
        </Row>
      )}
      {controls.has('log') && (
        <Row>
          <Segmented scroll value={st.log ? 'on' : 'off'} options={LOG} onChange={(v) => update(() => ({ log: v === 'on' }))} />
        </Row>
      )}
      {controls.has('keys') && (
        <Row>
          <Segmented scroll value={st.keys ? 'on' : 'off'} options={KEYS} onChange={(v) => update(() => ({ keys: v === 'on' }))} />
        </Row>
      )}
    </>
  )
}
