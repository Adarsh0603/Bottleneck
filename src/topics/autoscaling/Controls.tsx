import { Slider } from '../../core/controls'
import type { PanelProps } from '../../core/types'
import type { AutoscaleMetrics, AutoscaleSim } from './engine'
import type { AutoscaleState, Beat } from './types'

export default function Controls({ beat, st, update }: PanelProps<AutoscaleState, AutoscaleSim, AutoscaleMetrics, Beat>) {
  if (!beat.controls?.includes('target')) return null
  return (
    <div className="mt-4">
      <Slider
        label="Target"
        value={st.target}
        min={20}
        max={90}
        unit="% busy"
        hint="Lower keeps more spare servers running."
        onChange={(v) => update(() => ({ target: v }))}
      />
    </div>
  )
}
