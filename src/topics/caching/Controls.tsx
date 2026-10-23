import { Segmented, Slider } from '../../core/controls'
import type { PanelProps } from '../../core/types'
import { MAX_CAPACITY, topShare, type CachingMetrics, type CachingSim } from './engine'
import type { Beat, CachingState } from './types'

export default function Controls({ beat, st, update, stopRamp }: PanelProps<CachingState, CachingSim, CachingMetrics, Beat>) {
  if (!beat.controls) return null
  const show = new Set(beat.controls)

  return (
    <div className="mt-4 flex flex-wrap items-end gap-3">
      {show.has('traffic') && (
        <Slider
          label="Traffic"
          value={st.rps}
          min={1}
          max={15}
          unit="req/s"
          onChange={(v) => {
            stopRamp()
            update(() => ({ rps: v }))
          }}
        />
      )}
      {show.has('size') && (
        <Slider
          label="Cache size"
          value={st.capacity}
          min={1}
          max={MAX_CAPACITY}
          unit="items"
          hint={`The top ${st.capacity} items get about ${Math.round(topShare(st.capacity) * 100)}% of requests`}
          onChange={(v) => update(() => ({ capacity: v }))}
        />
      )}
      {show.has('ttl') && (
        <Slider
          label="TTL"
          value={st.ttl}
          min={1}
          max={30}
          unit="s"
          hint="How long an item stays before it must be fetched again"
          onChange={(v) => update(() => ({ ttl: v }))}
        />
      )}
      {show.has('coalesce') && (
        <Segmented
          value={st.coalesce ? 'on' : 'off'}
          options={[
            { value: 'off', label: 'Every miss queries' },
            { value: 'on', label: 'One fetch, others wait' },
          ]}
          onChange={(v) => update(() => ({ coalesce: v === 'on' }))}
        />
      )}
    </div>
  )
}
