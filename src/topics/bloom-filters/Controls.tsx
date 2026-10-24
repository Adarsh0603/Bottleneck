import { Segmented } from '../../core/controls'
import type { PanelProps } from '../../core/types'
import type { BloomMetrics, BloomSim } from './engine'
import type { Beat, BloomState, Kind } from './types'

const FILTER: { value: 'off' | 'on'; label: string }[] = [
  { value: 'off', label: 'No filter' },
  { value: 'on', label: 'Filter on' },
]

const BITS: { value: number; label: string }[] = [16, 32, 64, 128].map((n) => ({ value: n, label: `${n} switches` }))

const HASHES: { value: number; label: string }[] = [1, 2, 3, 4].map((n) => ({ value: n, label: n === 1 ? '1 hash' : `${n} hashes` }))

const NAMES: { value: number; label: string }[] = [4, 8, 16, 24].map((n) => ({ value: n, label: `${n} names` }))

const COUNTING: { value: 'plain' | 'counting'; label: string }[] = [
  { value: 'plain', label: 'Plain switches' },
  { value: 'counting', label: 'Counting switches' },
]

const TRAFFIC: { value: number; label: string }[] = [
  { value: 20, label: 'Mostly new names' },
  { value: 90, label: 'Mostly saved names' },
]

const Row = ({ children }: { children: React.ReactNode }) => <div className="mt-4">{children}</div>

const Button = ({ onClick, children }: { onClick: () => void; children: React.ReactNode }) => (
  <button onClick={onClick} className="rounded-xl bg-fg px-5 py-2 text-sm font-medium text-bg transition hover:opacity-90">
    {children}
  </button>
)

export default function Controls({ beat, st, update }: PanelProps<BloomState, BloomSim, BloomMetrics, Beat>) {
  const controls = new Set(beat.controls ?? [])
  const check = (kind: Kind) => update((prev) => ({ ask: prev.ask + 1, kind }))
  return (
    <>
      {(controls.has('check') || controls.has('lookalike') || controls.has('friend')) && (
        <Row>
          <div className="flex flex-wrap gap-2">
            {controls.has('check') && <Button onClick={() => check('new')}>Check a new name</Button>}
            {controls.has('lookalike') && <Button onClick={() => check('lookalike')}>Check a lookalike</Button>}
            {controls.has('friend') && <Button onClick={() => check('friend')}>Check another saved name</Button>}
          </div>
        </Row>
      )}
      {controls.has('delete') && (
        <Row>
          <Button onClick={() => update((prev) => ({ drop: prev.drop + 1 }))}>Delete a name</Button>
        </Row>
      )}
      {controls.has('filter') && (
        <Row>
          <Segmented value={st.filter ? 'on' : 'off'} options={FILTER} onChange={(v) => update(() => ({ filter: v === 'on' }))} />
        </Row>
      )}
      {controls.has('bits') && (
        <Row>
          <Segmented scroll value={st.bits} options={BITS} onChange={(v) => update(() => ({ bits: v }))} />
        </Row>
      )}
      {controls.has('hashes') && (
        <Row>
          <Segmented scroll value={st.hashes} options={HASHES} onChange={(v) => update(() => ({ hashes: v }))} />
        </Row>
      )}
      {controls.has('names') && (
        <Row>
          <Segmented scroll value={st.names} options={NAMES} onChange={(v) => update(() => ({ names: v }))} />
        </Row>
      )}
      {controls.has('counting') && (
        <Row>
          <Segmented scroll value={st.counting ? 'counting' : 'plain'} options={COUNTING} onChange={(v) => update(() => ({ counting: v === 'counting' }))} />
        </Row>
      )}
      {controls.has('traffic') && (
        <Row>
          <Segmented scroll value={st.taken} options={TRAFFIC} onChange={(v) => update(() => ({ taken: v }))} />
        </Row>
      )}
    </>
  )
}
