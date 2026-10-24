import { Segmented } from '../../core/controls'
import type { PanelProps } from '../../core/types'
import type { ShopMetrics, ShopSim } from './engine'
import { COOLDOWNS, POOLS, THREADS, TIMEOUTS, TRIPS, type Backoff } from './shop'
import type { Beat, ShopState } from './types'

const BACKOFFS: { value: Backoff; label: string }[] = [
  { value: 'none', label: 'Retry at once' },
  { value: 'exp', label: 'Wait longer each time' },
  { value: 'jitter', label: 'Wait longer, with jitter' },
]

const Row = ({ children }: { children: React.ReactNode }) => <div className="mt-4">{children}</div>

export default function Controls({ beat, st, update }: PanelProps<ShopState, ShopSim, ShopMetrics, Beat>) {
  const controls = new Set(beat.controls ?? [])
  return (
    <>
      {controls.has('threads') && (
        <Row>
          <Segmented scroll value={st.threads} options={THREADS.map((n) => ({ value: n, label: `${n} threads` }))} onChange={(v) => update(() => ({ threads: v }))} />
        </Row>
      )}
      {controls.has('timeout') && (
        <Row>
          <Segmented
            scroll
            value={st.timeout}
            options={TIMEOUTS.map((n) => ({ value: n, label: n === 0 ? 'No timeout' : `Give up after ${n} s` }))}
            onChange={(v) => update(() => ({ timeout: v }))}
          />
        </Row>
      )}
      {controls.has('retries') && (
        <Row>
          <Segmented
            scroll
            value={st.retries}
            options={[0, 1, 2, 3].map((n) => ({ value: n, label: n === 0 ? 'No retries' : n === 1 ? '1 retry' : `${n} retries` }))}
            onChange={(v) => update(() => ({ retries: v }))}
          />
        </Row>
      )}
      {controls.has('backoff') && (
        <Row>
          <Segmented scroll value={st.backoff} options={BACKOFFS} onChange={(v) => update(() => ({ backoff: v }))} />
        </Row>
      )}
      {controls.has('breaker') && (
        <Row>
          <Segmented
            scroll
            value={st.breaker ? 'on' : 'off'}
            options={[
              { value: 'off', label: 'No breaker' },
              { value: 'on', label: 'Circuit breaker' },
            ]}
            onChange={(v) => update(() => ({ breaker: v === 'on' }))}
          />
        </Row>
      )}
      {controls.has('trip') && st.breaker && (
        <Row>
          <Segmented scroll value={st.trip} options={TRIPS.map((n) => ({ value: n, label: `Opens after ${n} failures` }))} onChange={(v) => update(() => ({ trip: v }))} />
        </Row>
      )}
      {controls.has('cooldown') && st.breaker && (
        <Row>
          <Segmented scroll value={st.cooldown} options={COOLDOWNS.map((n) => ({ value: n, label: `Tests again after ${n} s` }))} onChange={(v) => update(() => ({ cooldown: v }))} />
        </Row>
      )}
      {controls.has('fallback') && (
        <Row>
          <Segmented
            scroll
            value={st.fallback ? 'page' : 'error'}
            options={[
              { value: 'error', label: 'Show an error' },
              { value: 'page', label: 'Show the page without reviews' },
            ]}
            onChange={(v) => update(() => ({ fallback: v === 'page' }))}
          />
        </Row>
      )}
      {controls.has('pool') && (
        <Row>
          <Segmented
            scroll
            value={st.pool}
            options={POOLS.map((n) => ({ value: n, label: n === 0 ? 'No limit' : `Reviews: at most ${n} thread${n === 1 ? '' : 's'}` }))}
            onChange={(v) => update(() => ({ pool: v }))}
          />
        </Row>
      )}
    </>
  )
}
