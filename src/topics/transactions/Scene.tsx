import type { ReactNode } from 'react'
import { depth } from '../../core/iso/geometry'
import { crowd, edge } from '../../core/iso/crowd'
import { IsoBox, Tag } from '../../core/iso/primitives'
import Viewport from '../../core/iso/Viewport'
import type { SceneProps, V3 } from '../../core/types'
import type { Hold, Kind, Msg, Order, TransactionsSim } from './engine'
import type { Beat, TransactionsState } from './types'
import { COORD, LOG, LOG_AT, MS_PER_TICK, orderColor, PART, PART_NAME, PARTS, SPOT, TICKS_PER_SECOND } from './world'

const FLY_Y = 0.7
const SLOTS = 3
const FLASH = TICKS_PER_SECOND * 2

const WORDS: Record<Kind, string> = {
  do: 'Do it',
  ok: 'Done',
  fail: 'Refused',
  undo: 'Undo',
  undone: 'Undone',
  ask: 'Can you?',
  yes: 'Yes',
  no: 'No',
  commit: 'Commit',
  abort: 'Abort',
  ack: 'OK',
}

const BIG = new Set<Kind>(['do', 'ask', 'commit', 'abort', 'undo'])

const HOLD: Record<Hold, string> = { idle: '', held: 'Locked', done: 'Done', undone: 'Undone', refused: 'Refused' }

export default function Scene({ simRef, lastTickAt, st, shot, shake, beat, quiet, markers }: SceneProps<TransactionsState, TransactionsSim, Beat>) {
  const sim = simRef.current
  if (!sim) return null

  const bounds: V3[] = [
    [SPOT.coord.x - 1.6, 2, 0],
    [LOG_AT.x, 1, LOG_AT.z + 1.2],
    [SPOT.pay.x + 1.6, 2, SPOT.stock.z - 1.4],
    [SPOT.pay.x + 1.6, 2, SPOT.ship.z + 1.4],
  ]

  return (
    <Viewport
      target={shot.target}
      zoom={shot.zoom}
      shake={shake}
      panKey={shot}
      label="Isometric view of an orders server on the left and three services on the right: stock, payment and shipping."
      markers={markers}
      bounds={bounds}
    >
      {({ now }) => {
        const frac = Math.min(1, Math.max(0, (now - lastTickAt.current) / MS_PER_TICK))
        const c = crowd(sim.msgs.length)
        const tags = new Set(beat.tags ?? [])
        const latest = sim.latest
        const down = sim.down

        const place = (m: Msg) => {
          const a = SPOT[m.from]
          const b = SPOT[m.to]
          // Constant speed: easing makes a slow trip crawl at each end and feel laggy.
          const p = Math.min(1, (sim.tick - m.sentAt + frac) / (m.arrive - m.sentAt))
          return { x: a.x + (b.x - a.x) * p, z: a.z + (b.z - a.z) * p, p }
        }

        const solids: { d: number; node: ReactNode }[] = [
          { d: depth(SPOT.coord.x, 0), node: <Coord key="coord" sim={sim} down={down} /> },
          ...(st.log && st.mode === 'saga' ? [{ d: depth(LOG_AT.x, LOG_AT.z), node: <Log key="log" sim={sim} /> }] : []),
          ...PARTS.map((p, i) => ({ d: depth(SPOT[p].x, SPOT[p].z), node: <Service key={p} sim={sim} index={i} /> })),
        ]
        solids.sort((a, b) => a.d - b.d)

        const labels: ReactNode[] = []
        if (tags.has('parties') || tags.has('status')) {
          const parts: string[] = []
          if (tags.has('parties')) parts.push('Orders')
          let bad = false
          if (tags.has('status') && latest) {
            parts.push(outcome(latest))
            bad = latest.outcome === 'broken'
          }
          if (parts.length) labels.push(<Tag key="coord" at={[SPOT.coord.x, COORD.h + 0.5, 0]} label={parts.join(' · ')} danger={bad} />)
          PARTS.forEach((p, i) => {
            const words: string[] = []
            if (tags.has('parties')) words.push(PART_NAME[p])
            const hold = latest?.holds[i]
            if (tags.has('status') && hold && HOLD[hold]) words.push(HOLD[hold])
            if (words.length) labels.push(<Tag key={p} at={[SPOT[p].x, PART.h + 1.2, SPOT[p].z]} label={words.join(' · ')} danger={hold === 'refused'} />)
          })
        }
        if (tags.has('crash') && down) labels.push(<Tag key="crash" at={[SPOT.coord.x, COORD.h + 1.4, 0]} label="Crashed" danger />)
        if (tags.has('crash') && !down && sim.tick - sim.backAt < FLASH * 1.5) {
          const word = st.mode === '2pc' ? 'Back · cancels the order' : st.mode === 'saga' && st.log ? 'Back · reads its log' : 'Back · remembers nothing'
          labels.push(<Tag key="back" at={[SPOT.coord.x, COORD.h + 1.4, 0]} label={word} />)
        }
        if (tags.has('log') && st.log && st.mode === 'saga') {
          const live = sim.latest
          const sent = live && live.pending?.kind === 'do' ? `${PART_NAME[PARTS[live.pending.part]]} was asked` : 'Steps so far'
          labels.push(<Tag key="log" at={[LOG_AT.x, LOG.h + 0.9, LOG_AT.z]} label={`Log · ${sent}`} />)
        }
        if (tags.has('repeat') && sim.tick - sim.repeatAt < FLASH * 1.5) {
          const at = SPOT[PARTS[sim.repeatPart]]
          labels.push(<Tag key="repeat" at={[at.x, PART.h + 2.1, at.z]} label={sim.repeatIgnored ? 'Repeat ignored' : 'Done twice'} danger={!sim.repeatIgnored} />)
        }
        if (tags.has('status') && sim.tick - sim.brokenAt < FLASH) {
          labels.push(<Tag key="broken" at={[SPOT.coord.x, COORD.h + 1.4, 0]} label="Half done" danger />)
        }
        if (tags.has('msgs') && latest) {
          for (const m of sim.msgs) {
            if (m.order !== latest.id) continue
            const { x, z, p } = place(m)
            labels.push(<Tag key={`m-${m.id}`} at={[x, FLY_Y + Math.sin(p * Math.PI) * 0.4 + 0.3, z]} label={m.again ? 'Again' : WORDS[m.kind]} danger={m.kind === 'fail' || m.kind === 'no'} />)
          }
        }

        return (
          <>
            {solids.map((s) => s.node)}

            {sim.msgs.map((m) => {
              const { x, z, p } = place(m)
              const k = (BIG.has(m.kind) ? 0.26 : 0.2) * c.scale
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

function outcome(o: Order): string {
  if (o.outcome === 'committed') return 'Completed'
  if (o.outcome === 'aborted') return 'Cancelled'
  if (o.outcome === 'broken') return 'Half done'
  return 'Working'
}

// Orders: a block with the latest orders on its lid. Faded is still working,
// a dashed outline is cancelled, red is half done.
function Coord({ sim, down }: { sim: TransactionsSim; down: boolean }) {
  const shown = [...sim.orders.values()].slice(-SLOTS)
  return (
    <g>
      <IsoBox x={SPOT.coord.x} z={0} w={COORD.w} d={COORD.d} h={COORD.h} dim={down} stroke={down ? 'var(--danger)' : 'var(--fg)'} />
      {shown.map((o, i) => (
        <IsoBox
          key={o.id}
          x={SPOT.coord.x + (i - (SLOTS - 1) / 2) * 0.42}
          z={0}
          y={COORD.h}
          w={0.32}
          d={0.32}
          h={0.32}
          fill={o.outcome === 'broken' ? 'var(--danger)' : orderColor(o.id)}
          opacity={o.outcome === 'running' ? 0.4 : 1}
          ghost={o.outcome === 'aborted'}
        />
      ))}
    </g>
  )
}

// A service: a block with what it holds for the latest orders on its lid.
// Faded is locked, solid is done, a dashed outline was undone, red refused.
function Service({ sim, index }: { sim: TransactionsSim; index: number }) {
  const at = SPOT[PARTS[index]]
  const shown = [...sim.orders.values()].filter((o) => o.holds[index] !== 'idle').slice(-SLOTS)
  return (
    <g>
      <IsoBox x={at.x} z={at.z} w={PART.w} d={PART.d} h={PART.h} />
      {shown.map((o, i) => {
        const hold = o.holds[index]
        return (
          <IsoBox
            key={o.id}
            x={at.x}
            z={at.z + (i - (SLOTS - 1) / 2) * 0.42}
            y={PART.h}
            w={0.32}
            d={0.32}
            h={0.32}
            fill={hold === 'refused' || o.times[index] > 1 ? 'var(--danger)' : orderColor(o.id)}
            opacity={hold === 'held' ? 0.4 : 1}
            ghost={hold === 'undone'}
          />
        )
      })}
    </g>
  )
}

// The progress log: one block for each step the saga wrote down for the newest
// order that is still running.
function Log({ sim }: { sim: TransactionsSim }) {
  const live = [...sim.orders.values()].filter((o) => o.outcome === 'running').pop()
  return (
    <g>
      <IsoBox x={LOG_AT.x} z={LOG_AT.z} w={LOG.w} d={LOG.d} h={LOG.h} />
      {live &&
        Array.from({ length: live.logged }, (_, i) => (
          <IsoBox key={i} x={LOG_AT.x + (i - 1) * 0.36} z={LOG_AT.z} y={LOG.h} w={0.28} d={0.28} h={0.28} fill={orderColor(live.id)} />
        ))}
    </g>
  )
}
