import { Segmented, Slider, Stepper } from '../../core/controls'
import type { PanelProps } from '../../core/types'
import { SIZES } from './chapters'
import type { Algorithm, LoadBalancerSim } from './engine'
import type { Beat, CourseState, Metrics } from './types'
import { capacity } from './useSim'

const MAX_SERVERS = 6

export default function Controls({ beat, st, sim, update, stopRamp }: PanelProps<CourseState, LoadBalancerSim, Metrics, Beat>) {
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
          hint={`This server handles ≈ ${capacity(sim).toFixed(1)} req/s`}
          onChange={(v) => {
            stopRamp()
            update(() => ({ rps: v }))
          }}
        />
      )}
      {show.has('size') && (
        <Segmented
          value={st.servers[0]}
          options={[
            ...SIZES.map((sz) => ({ value: sz.value, label: `${sz.label} · $${sz.cost}` })),
            { value: 8, label: '8× · not sold', disabled: true },
          ]}
          onChange={(v) => update(() => ({ servers: [v] }))}
        />
      )}
      {show.has('servers') && (
        <Stepper
          value={st.servers.length}
          min={1}
          max={MAX_SERVERS}
          label="server"
          onChange={(n) =>
            update((p) => ({
              servers: n > p.servers.length ? [...p.servers, 1] : p.servers.slice(0, n),
              down: p.down.filter((d) => d < n),
            }))
          }
        />
      )}
      {show.has('balancer') && (
        <Segmented
          value={st.balancer ? 'on' : 'off'}
          options={[
            { value: 'off', label: 'No load balancer' },
            { value: 'on', label: 'Load balancer' },
          ]}
          onChange={(v) => update(() => ({ balancer: v === 'on' }))}
        />
      )}
      {show.has('algorithm') && (
        <Segmented<Algorithm>
          value={st.algorithm}
          options={[
            { value: 'round-robin', label: 'Round robin' },
            { value: 'random', label: 'Random' },
            { value: 'least-connections', label: 'Least connections' },
          ]}
          onChange={(v) => update(() => ({ algorithm: v }))}
        />
      )}
    </div>
  )
}
