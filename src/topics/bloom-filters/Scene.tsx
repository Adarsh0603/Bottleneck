import type { ReactNode } from 'react'
import { depth } from '../../core/iso/geometry'
import { crowd, edge, glide } from '../../core/iso/crowd'
import { IsoBox, IsoCylinder, Tag } from '../../core/iso/primitives'
import Viewport from '../../core/iso/Viewport'
import type { SceneProps, V3 } from '../../core/types'
import type { BloomSim, Msg } from './engine'
import type { Beat, BloomState } from './types'
import { cellAt, DB, FORM, layout, MS_PER_TICK, nameOf, queryColor, SLAB_H, SPOT, TICKS_PER_SECOND } from './world'

const FLY_Y = 0.7
const FLASH = TICKS_PER_SECOND * 0.7 // a switch that just changed glows for this long
const SHOWN = TICKS_PER_SECOND * 1.6 // a verdict or answer label stays for this long
const MAX_WAITING = 6
const LIT_TICKS = 52 // a check's marks last this long, matching the engine

function size(m: Msg): number {
  return m.kind === 'answer' ? 0.2 : 0.26
}

export default function Scene({ simRef, lastTickAt, st, beat, shot, shake, quiet, markers }: SceneProps<BloomState, BloomSim, Beat>) {
  const sim = simRef.current
  if (!sim) return null

  const bounds: V3[] = [
    [SPOT.form.x, 2, 0],
    [SPOT.db.x + DB.r, 2, 0],
  ]

  return (
    <Viewport
      target={shot.target}
      zoom={shot.zoom}
      shake={shake}
      panKey={shot}
      label="Isometric view of a sign-up form on the left, a strip of switches in the middle and a database on the right."
      markers={markers}
      bounds={bounds}
    >
      {({ now }) => {
        const frac = Math.min(1, Math.max(0, (now - lastTickAt.current) / MS_PER_TICK))
        const c = crowd(sim.msgs.length)
        const tags = new Set(beat.tags ?? [])
        const showFilter = st.filter || tags.has('verdict') || beat.controls?.includes('filter') === true
        const rows = layout(st.bits).rows

        const place = (m: Msg) => {
          const a = SPOT[m.from]
          const b = SPOT[m.to]
          const p = glide(Math.min(1, (sim.tick - m.sentAt + frac) / (m.arrive - m.sentAt)))
          return { x: a.x + (b.x - a.x) * p, z: a.z + (b.z - a.z) * p, p }
        }

        const solids: { d: number; node: ReactNode }[] = [
          { d: depth(SPOT.form.x, 0), node: <IsoBox key="form" x={SPOT.form.x} z={0} w={FORM.w} d={FORM.d} h={FORM.h} /> },
          { d: depth(SPOT.db.x, 0), node: <Database key="db" sim={sim} /> },
        ]
        if (showFilter) solids.push({ d: depth(SPOT.filter.x, 0), node: <Filter key="filter" sim={sim} st={st} now={frac} /> })
        solids.sort((a, b) => a.d - b.d)

        const labels: ReactNode[] = []
        const answer = sim.lastAnswer
        if (tags.has('parties')) {
          const said = answer && sim.tick - answer.at < SHOWN ? ` · ${nameOf(answer.id)} ${answer.free ? 'free' : 'taken'}` : ''
          labels.push(<Tag key="form" at={[SPOT.form.x, FORM.h + 0.5, 0]} label={`Sign-up${said}`} danger={answer?.wrong && !!said} />)
          labels.push(<Tag key="db" at={[SPOT.db.x, DB.h + 0.9, 0]} label="Database" />)
          if (showFilter) labels.push(<Tag key="filter" at={[SPOT.filter.x, SLAB_H + 0.2 + rows * 0.3 + 0.6, 0]} label="Filter" />)
        }
        if (tags.has('queue') && sim.metrics.queue > 1) {
          labels.push(<Tag key="queue" at={[SPOT.db.x, DB.h + 1.5, 0]} label={`${sim.metrics.queue} waiting`} danger={sim.metrics.queue > 4} />)
        }
        const probe = sim.probes.length ? sim.probes[sim.probes.length - 1] : null
        if (tags.has('verdict') && showFilter && probe && sim.tick - probe.at < SHOWN) {
          const label = probe.wrong ? 'Wrongly “free”' : probe.maybe ? 'Maybe taken' : 'Definitely free'
          labels.push(<Tag key="verdict" at={[SPOT.filter.x, SLAB_H + 0.2 + rows * 0.3 + 1.5, 0]} label={label} danger={probe.wrong} />)
        }
        if (tags.has('victim') && sim.lastDrop && sim.tick - sim.lastDrop.at < SHOWN) {
          labels.push(<Tag key="victim" at={[SPOT.filter.x, SLAB_H + 0.2 + rows * 0.3 + 2.4, 0]} label={`${nameOf(sim.lastDrop.id)} deleted`} />)
        }

        return (
          <>
            {solids.map((s) => s.node)}

            {sim.msgs.map((m) => {
              const { x, z, p } = place(m)
              const k = size(m) * c.scale
              return (
                <IsoBox
                  key={m.id}
                  x={x}
                  z={z}
                  y={FLY_Y + Math.sin(p * Math.PI) * 0.4}
                  w={k}
                  d={k}
                  h={k}
                  fill={queryColor(m.n)}
                  opacity={c.opacity * edge(p)}
                />
              )
            })}

            {!quiet && labels}
          </>
        )
      }}
    </Viewport>
  )
}

// The strip of switches. An off switch lies flat. An on switch stands up, and
// with counting its height is its count. A check marks the switches it looks at
// with a small block in the check's colour.
function Filter({ sim, st, now }: { sim: BloomSim; st: BloomState; now: number }) {
  const { w, d, cell } = layout(st.bits)
  const marks = sim.probes.flatMap((p) => p.cells.map((i) => ({ i, n: p.n, age: sim.tick + now - p.at })))
  const cells = Array.from({ length: st.bits }, (_, i) => ({ i, ...cellAt(i, st.bits) })).sort((a, b) => depth(a.x, a.z) - depth(b.x, b.z))
  const dim = !st.filter

  return (
    <g>
      <IsoBox x={SPOT.filter.x} z={0} w={w} d={d} h={SLAB_H} dim={dim} />
      {cells.map(({ i, x, z }) => {
        const count = sim.counts[i] ?? 0
        const on = count > 0
        const fresh = sim.tick - (sim.litAt[i] ?? -FLASH) < FLASH
        const h = st.counting ? (on ? 0.1 + 0.12 * Math.min(count, 4) : 0.03) : on ? 0.2 : 0.03
        return (
          <IsoBox
            key={i}
            x={x}
            z={z}
            y={SLAB_H}
            w={cell}
            d={cell}
            h={h}
            fill={dim ? 'var(--iso-idle)' : fresh ? 'var(--srv-3)' : on ? 'var(--fg)' : 'var(--iso-idle)'}
          />
        )
      })}
      {marks.map(({ i, n, age }) => {
        const { x, z } = cellAt(i, st.bits)
        const count = sim.counts[i] ?? 0
        const top = st.counting ? 0.1 + 0.12 * Math.min(count, 4) : count > 0 ? 0.2 : 0.03
        return (
          <IsoBox
            key={`${n}-${i}`}
            x={x}
            z={z}
            y={SLAB_H + top + 0.16 + Math.sin(age / 3) * 0.04}
            w={0.16}
            d={0.16}
            h={0.16}
            fill={queryColor(n)}
            opacity={Math.max(0, Math.min(1, (LIT_TICKS - age) / 10))}
          />
        )
      })}
    </g>
  )
}

// The database: a cylinder with the lookup in progress on top and the lookups
// waiting beside it.
function Database({ sim }: { sim: BloomSim }) {
  const waiting = sim.dbQueue.slice(0, MAX_WAITING)
  return (
    <g>
      <IsoCylinder x={SPOT.db.x} z={0} r={DB.r} h={DB.h} />
      {sim.busy && <IsoBox x={SPOT.db.x} z={0} y={DB.h} w={0.3} d={0.3} h={0.3} fill={queryColor(sim.busy.n)} />}
      {waiting.map((n, i) => (
        <IsoBox key={n} x={SPOT.db.x + 1.5} z={(i - (MAX_WAITING - 1) / 2) * 0.34} w={0.26} d={0.26} h={0.26} fill={queryColor(n)} />
      ))}
    </g>
  )
}
