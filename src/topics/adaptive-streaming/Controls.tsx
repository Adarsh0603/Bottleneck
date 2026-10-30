import { Segmented } from '../../core/controls'
import type { PanelProps } from '../../core/types'
import { RUNGS, type StreamMetrics, type StreamSim } from './engine'
import type { Beat, Net, Rule, StreamState } from './types'

const NET_LABEL: Record<Net, string> = {
  fast: 'Fast (10 Mbps)',
  steady: 'Steady (3 Mbps)',
  dip: 'Drops for a while',
  tunnel: 'Goes through a tunnel',
  slow: 'Slow (0.8 Mbps)',
}

const RULE_LABEL: Record<Rule, string> = {
  throughput: 'Go by speed',
  buffer: 'Go by buffer',
}

const RUNG_OPTIONS = RUNGS.map((r, i) => ({ value: i, label: r.label }))

const Row = ({ children }: { children: React.ReactNode }) => <div className="mt-4">{children}</div>

const Button = ({ onClick, children }: { onClick: () => void; children: React.ReactNode }) => (
  <button onClick={onClick} className="rounded-xl bg-fg px-5 py-2 text-sm font-medium text-bg transition hover:opacity-90">
    {children}
  </button>
)

const onOff = (on: string, off: string) => [
  { value: 'off', label: off },
  { value: 'on', label: on },
]

export default function Controls({ beat, st, update }: PanelProps<StreamState, StreamSim, StreamMetrics, Beat>) {
  const controls = new Set(beat.controls ?? [])
  const nets = (beat.nets ?? []).map((value) => ({ value, label: NET_LABEL[value] }))
  const rules = (beat.rules ?? ['throughput', 'buffer']).map((value) => ({ value, label: RULE_LABEL[value] }))
  return (
    <>
      {controls.has('watch') && (
        <Row>
          <Button onClick={() => update((prev) => ({ watch: prev.watch + 1 }))}>Watch again</Button>
        </Row>
      )}
      {controls.has('net') && nets.length > 0 && (
        <Row>
          <Segmented scroll value={st.net} options={nets} onChange={(v) => update(() => ({ net: v }))} />
        </Row>
      )}
      {controls.has('rung') && st.mode !== 'abr' && (
        <Row>
          <Segmented scroll value={st.rung} options={RUNG_OPTIONS} onChange={(v) => update(() => ({ rung: v }))} />
        </Row>
      )}
      {controls.has('rule') && st.mode === 'abr' && (
        <Row>
          <Segmented scroll value={st.rule} options={rules} onChange={(v) => update(() => ({ rule: v }))} />
        </Row>
      )}
      {(controls.has('calm') || controls.has('start')) && st.mode === 'abr' && (
        <Row>
          <div className="flex flex-wrap gap-2">
            {controls.has('calm') && (
              <Segmented scroll value={st.calm ? 'on' : 'off'} options={onOff('One step at a time', 'Jump to the best fit')} onChange={(v) => update(() => ({ calm: v === 'on' }))} />
            )}
            {controls.has('start') && (
              <Segmented
                scroll
                value={st.start}
                options={[
                  { value: 'low', label: 'Start at 240p' },
                  { value: 'high', label: 'Start at 1080p' },
                ]}
                onChange={(v) => update(() => ({ start: v }))}
              />
            )}
          </div>
        </Row>
      )}
    </>
  )
}
