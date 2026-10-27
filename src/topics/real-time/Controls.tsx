import { Segmented } from '../../core/controls'
import type { PanelProps } from '../../core/types'
import type { RealtimeMetrics, RealtimeSim } from './engine'
import type { Beat, Mode, RealtimeState } from './types'

const MODE_LABEL: Record<Mode, string> = {
  manual: 'Pull to refresh',
  poll: 'Polling',
  long: 'Long polling',
  sse: 'Server-sent events',
  ws: 'WebSocket',
}

const INTERVALS = [1, 2, 5, 10].map((n) => ({ value: n, label: `Ask every ${n}s` }))
const PHONES = [1000, 10000, 100000].map((n) => ({ value: n, label: `${n.toLocaleString()} phones` }))
const SERVERS = [1, 2, 4].map((n) => ({ value: n, label: `${n} server${n > 1 ? 's' : ''}` }))

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

export default function Controls({ beat, st, update }: PanelProps<RealtimeState, RealtimeSim, RealtimeMetrics, Beat>) {
  const controls = new Set(beat.controls ?? [])
  const modes = (beat.modes ?? []).map((value) => ({ value, label: MODE_LABEL[value] }))
  const showButtons = ['send', 'check', 'reply', 'crash'].some((c) => controls.has(c as 'send'))
  return (
    <>
      {showButtons && (
        <Row>
          <div className="flex flex-wrap gap-2">
            {controls.has('send') && <Button onClick={() => update((prev) => ({ send: prev.send + 1 }))}>Friend sends</Button>}
            {controls.has('check') && <Button onClick={() => update((prev) => ({ check: prev.check + 1 }))}>Pull to refresh</Button>}
            {controls.has('reply') && <Button onClick={() => update((prev) => ({ reply: prev.reply + 1 }))}>Send a reply</Button>}
            {controls.has('crash') && <Button onClick={() => update((prev) => ({ crash: prev.crash + 1 }))}>Crash a server</Button>}
          </div>
        </Row>
      )}
      {controls.has('mode') && modes.length > 0 && (
        <Row>
          <Segmented scroll value={st.mode} options={modes} onChange={(v) => update(() => ({ mode: v }))} />
        </Row>
      )}
      {controls.has('interval') && (
        <Row>
          <Segmented scroll value={st.interval} options={INTERVALS} onChange={(v) => update(() => ({ interval: v }))} />
        </Row>
      )}
      {controls.has('phones') && (
        <Row>
          <Segmented scroll value={st.phones} options={PHONES} onChange={(v) => update(() => ({ phones: v }))} />
        </Row>
      )}
      {controls.has('servers') && (
        <Row>
          <Segmented scroll value={st.servers} options={SERVERS} onChange={(v) => update(() => ({ servers: v }))} />
        </Row>
      )}
      {(controls.has('flaky') || controls.has('heartbeat') || controls.has('backoff')) && (
        <Row>
          <div className="flex flex-wrap gap-2">
            {controls.has('flaky') && (
              <Segmented scroll value={st.flaky ? 'on' : 'off'} options={onOff('Phones drop out', 'Steady phones')} onChange={(v) => update(() => ({ flaky: v === 'on' }))} />
            )}
            {controls.has('heartbeat') && (
              <Segmented scroll value={st.heartbeat ? 'on' : 'off'} options={onOff('Heartbeat', 'No heartbeat')} onChange={(v) => update(() => ({ heartbeat: v === 'on' }))} />
            )}
            {controls.has('backoff') && (
              <Segmented scroll value={st.backoff ? 'on' : 'off'} options={onOff('Wait, then retry', 'Retry at once')} onChange={(v) => update(() => ({ backoff: v === 'on' }))} />
            )}
          </div>
        </Row>
      )}
    </>
  )
}
