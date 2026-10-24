import { Segmented } from '../../core/controls'
import type { PanelProps } from '../../core/types'
import type { RateMetrics, RateSim } from './engine'
import { ALGO_NAMES, BURSTS, LIMITS, type Algo, type Scope } from './gate'
import type { Beat, RateState } from './types'

const ALL_ALGOS: Algo[] = ['fixed', 'sliding', 'token', 'leaky']

const SCOPE: { value: Scope; label: string }[] = [
  { value: 'all', label: 'One limit for everyone' },
  { value: 'client', label: 'A limit for each client' },
]

export default function Controls({ beat, st, update }: PanelProps<RateState, RateSim, RateMetrics, Beat>) {
  const controls = new Set(beat.controls ?? [])
  return (
    <>
      {controls.has('limiting') && (
        <div className="mt-4">
          <Segmented
            scroll
            value={st.limiting ? 'on' : 'off'}
            options={[
              { value: 'off', label: 'No limit' },
              { value: 'on', label: 'Limit requests' },
            ]}
            onChange={(v) => update(() => ({ limiting: v === 'on' }))}
          />
        </div>
      )}
      {controls.has('algo') && (
        <div className="mt-4">
          <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted">Algorithm</div>
          <Segmented
            scroll
            value={st.algo}
            options={(beat.algos ?? ALL_ALGOS).map((a) => ({ value: a, label: ALGO_NAMES[a] }))}
            onChange={(v) => update(() => ({ algo: v }))}
          />
        </div>
      )}
      {controls.has('limit') && (
        <div className="mt-4">
          <Segmented scroll value={st.limit} options={LIMITS.map((n) => ({ value: n, label: `${n} / second` }))} onChange={(v) => update(() => ({ limit: v }))} />
        </div>
      )}
      {controls.has('burst') && (
        <div className="mt-4">
          <Segmented scroll value={st.burst} options={BURSTS.map((n) => ({ value: n, label: `Bucket of ${n}` }))} onChange={(v) => update(() => ({ burst: v }))} />
        </div>
      )}
      {controls.has('scope') && (
        <div className="mt-4">
          <Segmented scroll value={st.scope} options={SCOPE} onChange={(v) => update(() => ({ scope: v }))} />
        </div>
      )}
      {controls.has('counter') && (
        <div className="mt-4">
          <Segmented
            scroll
            value={st.shared ? 'shared' : 'each'}
            options={[
              { value: 'each', label: 'A counter in each gateway' },
              { value: 'shared', label: 'One shared counter' },
            ]}
            onChange={(v) => update(() => ({ shared: v === 'shared' }))}
          />
        </div>
      )}
    </>
  )
}
