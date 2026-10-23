import type { PanelProps } from '../../core/types'
import type { CdnMetrics, CdnSim } from './engine'
import type { Beat, CdnState } from './types'
import { REGIONS } from './world'

export default function Controls({ beat, st, update }: PanelProps<CdnState, CdnSim, CdnMetrics, Beat>) {
  if (!beat.controls?.includes('edges')) return null
  return (
    <div className="mt-4 inline-flex flex-wrap gap-1 rounded-xl border border-line bg-bg/80 p-1 backdrop-blur" role="group" aria-label="Edge servers">
      {REGIONS.map((r) => {
        const on = st.edges[r.id]
        return (
          <button
            key={r.id}
            aria-pressed={on}
            onClick={() => update((p) => ({ edges: { ...p.edges, [r.id]: !on } }))}
            className={`rounded-lg px-3 py-1.5 text-sm transition ${on ? 'bg-fg text-bg' : 'hover:bg-subtle'}`}
          >
            {on ? '✓ ' : '+ '}
            {r.name} edge
          </button>
        )
      })}
    </div>
  )
}
