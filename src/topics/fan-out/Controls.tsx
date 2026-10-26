import { Segmented } from '../../core/controls'
import type { PanelProps } from '../../core/types'
import type { FanoutMetrics, FanoutSim } from './engine'
import type { Beat, FanoutState, Mode } from './types'

const FOLLOWS: { value: number; label: string }[] = [4, 20, 100, 500].map((n) => ({ value: n, label: `${n} follows` }))

const READ_WRITE: { value: Mode; label: string }[] = [
  { value: 'read', label: 'Build on open' },
  { value: 'write', label: 'Deliver on post' },
]

const ALL_MODES: { value: Mode; label: string }[] = [...READ_WRITE, { value: 'hybrid', label: 'Mix of both' }]

const IDLE: { value: 'all' | 'skip'; label: string }[] = [
  { value: 'all', label: 'Everyone' },
  { value: 'skip', label: 'Skip idle followers' },
]

const Row = ({ children }: { children: React.ReactNode }) => <div className="mt-4">{children}</div>

const Button = ({ onClick, children }: { onClick: () => void; children: React.ReactNode }) => (
  <button onClick={onClick} className="rounded-xl bg-fg px-5 py-2 text-sm font-medium text-bg transition hover:opacity-90">
    {children}
  </button>
)

export default function Controls({ beat, st, update }: PanelProps<FanoutState, FanoutSim, FanoutMetrics, Beat>) {
  const controls = new Set(beat.controls ?? [])
  return (
    <>
      {(controls.has('open') || controls.has('celeb')) && (
        <Row>
          <div className="flex flex-wrap gap-2">
            {controls.has('open') && <Button onClick={() => update((prev) => ({ open: prev.open + 1 }))}>Open the app</Button>}
            {controls.has('celeb') && <Button onClick={() => update((prev) => ({ star: prev.star + 1 }))}>Celebrity posts</Button>}
          </div>
        </Row>
      )}
      {(controls.has('modeRW') || controls.has('mode')) && (
        <Row>
          <Segmented scroll value={st.mode} options={controls.has('mode') ? ALL_MODES : READ_WRITE} onChange={(v) => update(() => ({ mode: v }))} />
        </Row>
      )}
      {controls.has('idle') && (
        <Row>
          <Segmented scroll value={st.skipIdle ? 'skip' : 'all'} options={IDLE} onChange={(v) => update(() => ({ skipIdle: v === 'skip' }))} />
        </Row>
      )}
      {controls.has('follows') && (
        <Row>
          <Segmented scroll value={st.follows} options={FOLLOWS} onChange={(v) => update(() => ({ follows: v }))} />
        </Row>
      )}
    </>
  )
}
