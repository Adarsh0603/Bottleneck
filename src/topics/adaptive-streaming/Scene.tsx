import type { ReactNode } from 'react'
import { depth } from '../../core/iso/geometry'
import { edge, glide } from '../../core/iso/crowd'
import { IsoBox, Tag } from '../../core/iso/primitives'
import Viewport from '../../core/iso/Viewport'
import type { SceneProps, V3 } from '../../core/types'
import { MAX_BUF, RUNGS, type StreamSim } from './engine'
import type { Beat, StreamState } from './types'
import { MS_PER_TICK, PHONE, SERVER, SPOT } from './world'

const FLY_Y = 0.55
const GAUGE = 2.4 // height of a full buffer
const TANK = { x: SPOT.phone.x + 1.5, z: 0 }
const PIPE_MAX = 1.3

export default function Scene({ simRef, lastTickAt, st, beat, shot, shake, quiet, markers }: SceneProps<StreamState, StreamSim, Beat>) {
  const sim = simRef.current
  if (!sim) return null

  const bounds: V3[] = [
    [SPOT.server.x - SERVER.w, 2, 0],
    [TANK.x + 0.6, 2, 0],
  ]

  return (
    <Viewport
      target={shot.target}
      zoom={shot.zoom}
      shake={shake}
      panKey={shot}
      label="Isometric view of a server on the left, a network pipe in the middle, and a phone with a tank of buffered video on the right."
      markers={markers}
      bounds={bounds}
    >
      {({ now }) => {
        const frac = Math.min(1, Math.max(0, (now - lastTickAt.current) / MS_PER_TICK))
        const tags = new Set(beat.tags ?? [])
        const m = sim.metrics
        const pipeW = Math.max(0.12, Math.min(PIPE_MAX, 0.1 + m.speed * 0.12))
        const x0 = SPOT.server.x + SERVER.w / 2
        const x1 = SPOT.phone.x - PHONE.w / 2

        // What is in flight: one piece, or a trickle for a single file.
        const flying: { p: number; rung: number }[] = []
        if (sim.fetch) flying.push({ p: Math.min(1, sim.fetch.got / sim.fetch.bits), rung: sim.fetch.rung })
        else if (st.mode === 'file' && m.speed > 0 && sim.state !== 'done') {
          for (let i = 0; i < 4; i++) flying.push({ p: (sim.time * 0.35 + i / 4 + frac * 0.02) % 1, rung: st.rung })
        }

        const solids: { d: number; node: ReactNode }[] = [
          { d: depth(SPOT.server.x, 0), node: <Server key="server" st={st} sim={sim} /> },
          { d: depth(SPOT.phone.x, 0), node: <Phone key="phone" sim={sim} /> },
          { d: depth(TANK.x, TANK.z), node: <Tank key="tank" sim={sim} /> },
        ]
        solids.sort((a, b) => a.d - b.d)

        const labels: ReactNode[] = []
        if (tags.has('parties')) {
          labels.push(<Tag key="server" at={[SPOT.server.x, SERVER.h + 1.5, 0]} label="Server" />)
          labels.push(<Tag key="phone" at={[SPOT.phone.x, PHONE.h + 1.4, 0]} label="Your phone" />)
        }
        if (tags.has('pipe')) labels.push(<Tag key="pipe" at={[(x0 + x1) / 2, 1.1, 0]} label={`${m.speed.toFixed(1)} Mbps`} />)
        if (tags.has('ladder')) labels.push(<Tag key="ladder" at={[SPOT.server.x, SERVER.h + 2.3, 0]} label={st.mode === 'abr' ? '4 qualities' : RUNGS[st.rung].label} />)
        if (tags.has('buffer')) labels.push(<Tag key="buffer" at={[TANK.x, GAUGE + 0.9, 0]} label={`${m.buffer.toFixed(0)} s ahead`} danger={m.frozen} />)
        if (m.frozen) labels.push(<Tag key="frozen" at={[SPOT.phone.x, PHONE.h + 0.7, 0]} label="Frozen" danger />)

        return (
          <>
            <IsoBox x={(x0 + x1) / 2} z={0} w={x1 - x0} d={PIPE_MAX} h={0.06} ghost />
            <IsoBox x={(x0 + x1) / 2} z={0} w={x1 - x0} d={pipeW} h={0.06} />
            {solids.map((s) => s.node)}
            {flying.map((f, i) => {
              const p = glide(f.p)
              const k = 0.18 + f.rung * 0.08
              return <IsoBox key={i} x={x0 + (x1 - x0) * p} z={0} y={FLY_Y} w={k} d={k} h={k} fill="var(--fg)" opacity={edge(p)} />
            })}
            {!quiet && labels}
          </>
        )
      }}
    </Viewport>
  )
}

// The server: a tall box, with the qualities on top as bars. In single-quality
// modes only the one on offer shows; with several, the one being sent is solid.
function Server({ st, sim }: { st: StreamState; sim: StreamSim }) {
  const abr = st.mode === 'abr'
  const using = sim.fetch?.rung ?? (abr ? -1 : st.rung)
  const shown = abr ? RUNGS.map((_, i) => i) : [st.rung]
  const zs = (i: number) => (i - (shown.length - 1) / 2) * 0.55
  return (
    <g>
      <IsoBox x={SPOT.server.x} z={0} w={SERVER.w} d={SERVER.d} h={SERVER.h} />
      {shown.map((r, i) => (
        <IsoBox
          key={r}
          x={SPOT.server.x}
          z={zs(i)}
          y={SERVER.h}
          w={0.4}
          d={0.4}
          h={0.15 + RUNGS[r].mbps * 0.16}
          fill={using === r ? 'var(--fg)' : undefined}
          ghost={using !== r && abr}
        />
      ))}
    </g>
  )
}

// The phone, with its screen on top: solid and taller for a better picture,
// dashed while it waits or is frozen.
function Phone({ sim }: { sim: StreamSim }) {
  const m = sim.metrics
  return (
    <g>
      <IsoBox x={SPOT.phone.x} z={0} w={PHONE.w} d={PHONE.d} h={PHONE.h} />
      {m.playing && m.shown >= 0 ? (
        <IsoBox x={SPOT.phone.x} z={0} y={PHONE.h} w={0.5} d={0.6} h={0.08 + m.shown * 0.07} fill="var(--fg)" />
      ) : (
        <IsoBox x={SPOT.phone.x} z={0} y={PHONE.h} w={0.5} d={0.6} h={0.1} ghost />
      )}
    </g>
  )
}

// The buffer: a tank beside the phone. New video lands at the bottom and the
// phone plays from the top, so the level drops while playing. Wider slabs are
// a better picture.
function Tank({ sim }: { sim: StreamSim }) {
  let y = 0
  const slabs: ReactNode[] = []
  for (let i = sim.pieces.length - 1; i >= 0; i--) {
    const p = sim.pieces[i]
    const h = Math.min(GAUGE - y, (p.secs / MAX_BUF) * GAUGE)
    if (h <= 0.005) continue
    slabs.push(<IsoBox key={`${i}-${p.rung}`} x={TANK.x} z={TANK.z} y={y} w={0.35 + p.rung * 0.12} d={0.35 + p.rung * 0.12} h={h} fill="var(--fg)" />)
    y += h
  }
  return (
    <g>
      <IsoBox x={TANK.x} z={TANK.z} w={0.8} d={0.8} h={GAUGE} ghost />
      {slabs}
    </g>
  )
}
