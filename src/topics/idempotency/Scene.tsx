import type { ReactNode } from 'react'
import { depth } from '../../core/iso/geometry'
import { crowd, edge, glide } from '../../core/iso/crowd'
import { IsoBox, Tag } from '../../core/iso/primitives'
import Viewport from '../../core/iso/Viewport'
import type { SceneProps, V3 } from '../../core/types'
import type { IdempotencySim, Msg } from './engine'
import type { Beat, IdempotencyState } from './types'
import { LEDGER, MS_PER_TICK, orderColor, PHONE, SERVER, SPOT, TICKS_PER_SECOND } from './world'

const FLY_Y = 0.7
const SLOTS = 6
const FLASH = TICKS_PER_SECOND * 2

// How a message on the wire looks. Each payment keeps its colour end to end.
function size(m: Msg): number {
  return m.kind === 'pay' ? 0.26 : m.kind === 'reply' ? 0.22 : 0.2
}

export default function Scene({ simRef, lastTickAt, st, beat, shot, shake, quiet, markers }: SceneProps<IdempotencyState, IdempotencySim, Beat>) {
  const sim = simRef.current
  if (!sim) return null

  const bounds: V3[] = [
    [SPOT.phone.x, 2, 0],
    [SPOT.ledger.x + LEDGER.w / 2, 2, 0],
  ]
  const queue = st.sender === 'queue'

  return (
    <Viewport
      target={shot.target}
      zoom={shot.zoom}
      shake={shake}
      panKey={shot}
      label="Isometric view of a phone on the left, a payments server in the middle and a ledger of charges on the right."
      markers={markers}
      bounds={bounds}
    >
      {({ now }) => {
        const frac = Math.min(1, Math.max(0, (now - lastTickAt.current) / MS_PER_TICK))
        const c = crowd(sim.msgs.length)
        const tags = new Set(beat.tags ?? [])
        const down = sim.down

        const place = (m: Msg) => {
          const a = SPOT[m.from]
          const b = SPOT[m.to]
          const p = glide(Math.min(1, (sim.tick - m.sentAt + frac) / (m.arrive - m.sentAt)))
          return { x: a.x + (b.x - a.x) * p, z: a.z + (b.z - a.z) * p, p }
        }
        // A lost message is gone from the middle of the way.
        const flying = sim.msgs.filter((m) => !m.doomed || place(m).p < 0.5)

        const solids: { d: number; node: ReactNode }[] = [
          { d: depth(SPOT.phone.x, 0), node: <IsoBox key="phone" x={SPOT.phone.x} z={0} w={PHONE.w} d={PHONE.d} h={PHONE.h} fill="var(--srv-1)" /> },
          { d: depth(SPOT.server.x, 0), node: <Server key="server" sim={sim} down={down} /> },
          { d: depth(SPOT.ledger.x, 0), node: <Ledger key="ledger" sim={sim} /> },
        ]
        solids.sort((a, b) => a.d - b.d)

        const labels: ReactNode[] = []
        if (tags.has('parties') || tags.has('status')) {
          const latest = sim.latest
          const parts: string[] = []
          if (tags.has('parties')) parts.push(queue ? 'Queue' : 'Phone')
          if (tags.has('status') && latest) parts.push(latest.state === 'paid' ? (queue ? 'Acknowledged' : 'Paid') : latest.state === 'unknown' ? 'Unknown' : 'Waiting')
          if (parts.length) labels.push(<Tag key="phone" at={[SPOT.phone.x, PHONE.h + 0.5, 0]} label={parts.join(' · ')} danger={latest?.state === 'unknown' && tags.has('status')} />)
        }
        if (tags.has('parties')) {
          labels.push(<Tag key="server" at={[SPOT.server.x, SERVER.h + 1, 0]} label={queue ? 'Consumer' : 'Payments'} />)
          labels.push(<Tag key="ledger" at={[SPOT.ledger.x, LEDGER.h + 0.9, 0]} label="Ledger" />)
        }
        if (tags.has('keys') && sim.records.size) labels.push(<Tag key="keys" at={[SPOT.server.x, SERVER.h + 0.55, 0]} label={queue ? 'Seen message ids' : 'Saved keys'} />)
        if (tags.has('crash') && down) labels.push(<Tag key="crash" at={[SPOT.server.x, SERVER.h + 1, 0]} label="Crashed" danger />)
        if (tags.has('dupe') && sim.tick - sim.dupeAt < FLASH) {
          labels.push(<Tag key="dupe" at={[SPOT.ledger.x, LEDGER.h + 1.5, 0]} label={queue ? 'Applied twice' : 'Charged twice'} danger />)
        }
        for (const m of sim.msgs) {
          const { x, z, p } = place(m)
          const at: V3 = [x, FLY_Y + Math.sin(p * Math.PI) * 0.4 + 0.3, z]
          if (tags.has('lost') && m.doomed && p >= 0.5) labels.push(<Tag key={`lost-${m.id}`} at={[x, FLY_Y + 0.5, z]} label="Lost" danger />)
          else if (tags.has('retry') && m.kind === 'pay' && m.attempt > 0 && !m.copy) labels.push(<Tag key={`retry-${m.id}`} at={at} label={queue ? 'Again' : 'Retry'} />)
          else if (tags.has('replay') && m.kind === 'reply' && m.replay) labels.push(<Tag key={`replay-${m.id}`} at={at} label="Saved answer" />)
        }

        return (
          <>
            {solids.map((s) => s.node)}

            {flying.map((m) => {
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
                  fill={orderColor(m.order)}
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

// Payments: a block with its notebook of keys on the lid. A claimed key that is
// still in progress is faded.
function Server({ sim, down }: { sim: IdempotencySim; down: boolean }) {
  const keys = [...sim.records].slice(-SLOTS)
  return (
    <g>
      <IsoBox x={SPOT.server.x} z={0} w={SERVER.w} d={SERVER.d} h={SERVER.h} dim={down} stroke={down ? 'var(--danger)' : 'var(--fg)'} />
      {!down &&
        keys.map(([key, done], i) => (
          <IsoBox
            key={key}
            x={SPOT.server.x + (i - (SLOTS - 1) / 2) * 0.24}
            z={0}
            y={SERVER.h}
            w={0.18}
            d={0.18}
            h={0.18}
            fill={orderColor(key)}
            opacity={done ? 1 : 0.4}
          />
        ))}
    </g>
  )
}

// The ledger: one block per charge on the lid. A second charge for the same
// order is red.
function Ledger({ sim }: { sim: IdempotencySim }) {
  const shown = sim.ledger.slice(-SLOTS)
  return (
    <g>
      <IsoBox x={SPOT.ledger.x} z={0} w={LEDGER.w} d={LEDGER.d} h={LEDGER.h} />
      {shown.map((e, i) => (
        <IsoBox
          key={sim.ledger.length - shown.length + i}
          x={SPOT.ledger.x + (i - (SLOTS - 1) / 2) * 0.42}
          z={0}
          y={LEDGER.h}
          w={0.32}
          d={0.32}
          h={0.32}
          fill={e.dup ? 'var(--danger)' : orderColor(e.order)}
        />
      ))}
    </g>
  )
}
