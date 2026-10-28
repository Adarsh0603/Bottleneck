import { Segmented } from '../../core/controls'
import type { PanelProps } from '../../core/types'
import type { GeoMetrics, GeoSim } from './engine'
import type { Beat, City, GeoState, Method } from './types'

const METHOD_LABEL: Record<Method, string> = {
  scan: 'Check every car',
  grid: 'Grid',
  geohash: 'Geohash',
  quadtree: 'Quadtree',
}

const DRIVERS = [40, 400, 4000].map((n) => ({ value: n, label: `${n.toLocaleString()} cars` }))
const CITIES: { value: City; label: string }[] = [
  { value: 'even', label: 'Spread out' },
  { value: 'downtown', label: 'Busy downtown' },
]

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

export default function Controls({ beat, st, update }: PanelProps<GeoState, GeoSim, GeoMetrics, Beat>) {
  const controls = new Set(beat.controls ?? [])
  const methods = (beat.methods ?? []).map((value) => ({ value, label: METHOD_LABEL[value] }))
  // In a geohash, a cell is named by letters: one more letter, four times more cells.
  const sizes = [4, 8, 16].map((n) => ({ value: n, label: st.method === 'geohash' ? `${Math.log2(n)} letters` : `${n} × ${n} cells` }))
  return (
    <>
      {controls.has('ask') && (
        <Row>
          <Button onClick={() => update((prev) => ({ ask: prev.ask + 1 }))}>Ask for a car</Button>
        </Row>
      )}
      {controls.has('method') && methods.length > 0 && (
        <Row>
          <Segmented scroll value={st.method} options={methods} onChange={(v) => update(() => ({ method: v }))} />
        </Row>
      )}
      {controls.has('drivers') && (
        <Row>
          <Segmented scroll value={st.drivers} options={DRIVERS} onChange={(v) => update(() => ({ drivers: v }))} />
        </Row>
      )}
      {controls.has('city') && (
        <Row>
          <Segmented scroll value={st.city} options={CITIES} onChange={(v) => update(() => ({ city: v }))} />
        </Row>
      )}
      {controls.has('res') && (st.method === 'grid' || st.method === 'geohash') && (
        <Row>
          <Segmented scroll value={st.res} options={sizes} onChange={(v) => update(() => ({ res: v }))} />
        </Row>
      )}
      {(controls.has('neighbours') || controls.has('widen')) && (
        <Row>
          <div className="flex flex-wrap gap-2">
            {controls.has('neighbours') && (st.method === 'grid' || st.method === 'geohash') && (
              <Segmented scroll value={st.neighbours ? 'on' : 'off'} options={onOff('Cell and neighbours', 'Own cell only')} onChange={(v) => update(() => ({ neighbours: v === 'on' }))} />
            )}
            {controls.has('widen') && st.method === 'geohash' && (
              <Segmented scroll value={st.widen ? 'on' : 'off'} options={onOff('Drop a letter when empty', 'Never drop a letter')} onChange={(v) => update(() => ({ widen: v === 'on' }))} />
            )}
          </div>
        </Row>
      )}
    </>
  )
}
