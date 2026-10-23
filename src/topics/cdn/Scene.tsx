import { useRef, type ReactNode } from 'react'
import { Piece } from '../../core/build/pieces'
import { depth, points } from '../../core/iso/geometry'
import { Crowd, FloorPath, IsoBox, Tag } from '../../core/iso/primitives'
import Viewport from '../../core/iso/Viewport'
import type { SceneProps, V3 } from '../../core/types'
import type { CdnSim } from './engine'
import type { Beat, CdnState } from './types'
import { edgeKey, edgeSpot, MS_PER_TICK, ORIGIN, REGIONS, SLOW_MS, spotOf, TICKS_PER_SECOND, usersKey } from './world'

const CUBE = 0.22
const FLY_Y = 0.55
const HIT_SECONDS = 0.5
const RISE_MS = 800

export default function Scene({ simRef, lastTickAt, st, beat, shot, shake, quiet, markers }: SceneProps<CdnState, CdnSim, Beat>) {
  const born = useRef(new Map<string, number>())
  const sim = simRef.current
  if (!sim) return null

  return (
    <Viewport target={shot.target} zoom={shot.zoom} shake={shake} panKey={shot} label="Map of users around the world and the servers answering them." markers={markers}>
      {({ now }) => {
        const flow = sim.flow
        const frac = Math.min(1, Math.max(0, (now - lastTickAt.current) / MS_PER_TICK))
        const m = sim.metrics
        const tags = new Set(beat.tags ?? [])
        const riseOf = (key: string) => {
          if (!born.current.has(key)) born.current.set(key, now)
          const t = Math.min(1, (now - born.current.get(key)!) / RISE_MS)
          return 1 - Math.pow(1 - t, 3)
        }

        const routes: V3[][] = []
        for (const r of REGIONS) {
          const from = usersKey(r.id)
          for (const t of flow.targets(from)) {
            const b = spotOf(t.key)!
            routes.push([
              [r.x, 0, r.z],
              [b.x, 0, b.z],
            ])
          }
          if (st.edges[r.id]) {
            const e = edgeSpot(r.id)
            routes.push([
              [e.x, 0, e.z],
              [ORIGIN.x, 0, ORIGIN.z],
            ])
          }
        }

        const solids: { d: number; node: ReactNode }[] = [
          { d: depth(ORIGIN.x, ORIGIN.z), node: <Origin key="origin" busy={sim.origin.active.length} /> },
        ]
        for (const r of REGIONS) {
          solids.push({ d: depth(r.x, r.z), node: <Crowd key={r.id} x={r.x} z={r.z} active={Math.round(st.rps * 2)} /> })
          if (st.edges[r.id]) {
            const e = edgeSpot(r.id)
            solids.push({
              d: depth(e.x, e.z),
              node: <Piece key={`edge-${r.id}`} kind="cache" x={e.x} z={e.z} node={sim.edges[r.id]} rise={riseOf(r.id)} />,
            })
          } else {
            born.current.delete(r.id)
          }
        }
        solids.sort((a, b) => a.d - b.d)

        const labels: ReactNode[] = []
        if (tags.has('origin')) labels.push(<Tag key="origin" at={[ORIGIN.x, 2.6, ORIGIN.z]} label="Origin server" />)
        if (tags.has('regions')) {
          for (const r of REGIONS) {
            const ms = m.latency[r.id]
            labels.push(
              <Tag key={r.id} at={[r.x, 1.2, r.z]} label={ms ? `${r.name} · ${(ms / 1000).toFixed(1)}s` : r.name} danger={ms > SLOW_MS} />,
            )
          }
        }
        if (tags.has('edges')) {
          for (const r of REGIONS) {
            if (!st.edges[r.id]) continue
            const e = edgeSpot(r.id)
            labels.push(<Tag key={`e-${r.id}`} at={[e.x, 1.2, e.z]} label="Edge" />)
          }
        }

        return (
          <>
            {routes.map((route, i) => (
              <FloorPath key={i} route={route} />
            ))}
            {solids.map((s) => s.node)}

            {/* Requests on their way: far trips take visibly longer. */}
            {flow.inTransit.map((t) => {
              const a = spotOf(t.from)
              const b = spotOf(t.to)
              if (!a || !b) return null
              const p = Math.min(1, t.progress + frac / t.ticks)
              const x = a.x + (b.x - a.x) * p
              const z = a.z + (b.z - a.z) * p
              return <IsoBox key={t.job.id} x={x} z={z} y={FLY_Y + Math.sin(p * Math.PI) * 0.3} w={CUBE} d={CUBE} h={CUBE} fill="var(--fg)" />
            })}

            {/* Hits bounce straight back from the edge to its users. */}
            {REGIONS.flatMap((r) => {
              if (!st.edges[r.id]) return []
              const e = edgeSpot(r.id)
              return sim.edges[r.id].events.map((ev, i) => {
                if (ev.kind !== 'hit') return null
                const age = (sim.tick - ev.tick + frac) / TICKS_PER_SECOND
                if (age > HIT_SECONDS) return null
                const p = age / HIT_SECONDS
                return (
                  <IsoBox
                    key={`${edgeKey(r.id)}-${i}-${ev.tick}`}
                    x={e.x + (r.x - e.x) * p}
                    z={e.z + (r.z - e.z) * p}
                    y={FLY_Y + Math.sin(p * Math.PI) * 0.4}
                    w={CUBE}
                    d={CUBE}
                    h={CUBE}
                    fill="var(--fg)"
                    opacity={1 - p}
                  />
                )
              })
            })}

            {!quiet && labels}
          </>
        )
      }}
    </Viewport>
  )
}

// The one server everything starts from: a tall box with rack vents and
// worker lights on top.
function Origin({ busy }: { busy: number }) {
  const { x, z } = ORIGIN
  const w = 1.6
  const h = 2.1
  const x0 = x - w / 2
  return (
    <g>
      <IsoBox x={x} z={z} w={w} d={w} h={h} />
      {[0.35, 0.65, 0.95, 1.25, 1.55].map((y) => (
        <polyline
          key={y}
          points={points([
            [x0, y, z - w * 0.3],
            [x0, y, z + w * 0.3],
          ])}
          stroke="var(--line)"
          strokeWidth={3}
          strokeLinecap="round"
        />
      ))}
      {Array.from({ length: 8 }, (_, i) => (
        <IsoBox
          key={i}
          x={x - 0.45 + (i % 4) * 0.3}
          z={z - 0.25 + Math.floor(i / 4) * 0.5}
          y={h}
          w={0.22}
          d={0.22}
          h={0.22}
          fill={i < busy ? 'var(--fg)' : undefined}
        />
      ))}
    </g>
  )
}
