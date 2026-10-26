import type { ReactNode } from 'react'
import { depth, project, S } from '../../core/iso/geometry'
import { crowd, edge, glide } from '../../core/iso/crowd'
import { IsoBox, IsoCylinder, Tag } from '../../core/iso/primitives'
import Viewport from '../../core/iso/Viewport'
import type { SceneProps, V3 } from '../../core/types'
import type { FanoutSim, Msg } from './engine'
import type { Beat, FanoutState } from './types'
import { AUTHOR, AUTHORS, INBOX, MS_PER_TICK, READER, SERVER, SPOT, STORE, TICKS_PER_SECOND } from './world'

const FLY_Y = 0.7
const SHOWN = TICKS_PER_SECOND * 2.2 // the wait label stays for this long
const MAX_WAITING = 6

// Everything is neutral except the celebrity and what she posts, which stand out.
const STAR = 'var(--fg)'

function fillOf(m: Msg): string | undefined {
  return (m.kind === 'post' || m.kind === 'write') && m.star ? STAR : undefined
}

export default function Scene({ simRef, lastTickAt, st, beat, shot, shake, quiet, markers }: SceneProps<FanoutState, FanoutSim, Beat>) {
  const sim = simRef.current
  if (!sim) return null

  const showInbox = st.mode !== 'read'
  const bounds: V3[] = [
    [SPOT.a0.x, 2, 0],
    [SPOT.reader.x + READER.w, 2, 0],
  ]

  return (
    <Viewport
      target={shot.target}
      zoom={shot.zoom}
      shake={shake}
      panKey={shot}
      label="Isometric view of the people you follow on the left, a post store, a feed server, inboxes, and you on the right."
      markers={markers}
      bounds={bounds}
    >
      {({ now }) => {
        const frac = Math.min(1, Math.max(0, (now - lastTickAt.current) / MS_PER_TICK))
        const c = crowd(sim.msgs.length)
        const tags = new Set(beat.tags ?? [])

        const place = (m: Msg) => {
          const a = SPOT[m.from]
          const b = SPOT[m.to]
          const p = glide(Math.min(1, (sim.tick - m.sentAt + frac) / (m.arrive - m.sentAt)))
          return { x: a.x + (b.x - a.x) * p, z: a.z + (b.z - a.z) * p, p }
        }

        const solids: { d: number; node: ReactNode }[] = [
          ...Array.from({ length: sim.authors }, (_, i) => {
            const spot = SPOT[`a${i}` as 'a0']
            return { d: depth(spot.x, spot.z), node: <Person key={`a${i}`} x={spot.x} z={spot.z} /> }
          }),
          { d: depth(SPOT.store.x, 0), node: <Store key="store" sim={sim} /> },
          { d: depth(SPOT.server.x, 0), node: <IsoBox key="server" x={SPOT.server.x} z={0} w={SERVER.w} d={SERVER.d} h={SERVER.h} /> },
          { d: depth(SPOT.reader.x, 0), node: <Reader key="reader" sim={sim} /> },
        ]
        if (st.celeb) {
          const spot = SPOT[`a${AUTHORS - 1}` as 'a3']
          solids.push({ d: depth(spot.x, spot.z), node: <Person key="star" x={spot.x} z={spot.z} star /> })
        }
        if (showInbox) solids.push({ d: depth(SPOT.inbox.x, SPOT.inbox.z), node: <Inboxes key="inbox" sim={sim} /> })
        solids.sort((a, b) => a.d - b.d)

        const labels: ReactNode[] = []
        if (tags.has('parties')) {
          labels.push(<Tag key="people" at={[SPOT.a0.x, AUTHOR.h + 0.9, SPOT.a0.z]} label={`You follow ${st.follows}`} />)
          if (st.celeb) labels.push(<Tag key="star" at={[SPOT.a3.x, AUTHOR.h + 1.2, SPOT.a3.z]} label="Celebrity" />)
          labels.push(<Tag key="store" at={[SPOT.store.x, STORE.h + 0.9, 0]} label="Post store" />)
          labels.push(<Tag key="server" at={[SPOT.server.x, SERVER.h + 0.5, 0]} label="Feed server" />)
          if (showInbox) labels.push(<Tag key="inbox" at={[SPOT.inbox.x, INBOX.h + 0.9, SPOT.inbox.z]} label="Inboxes" />)
          const waited = sim.tick - sim.lastFeedAt < SHOWN ? ` · feed in ${sim.metrics.lastWait.toFixed(1)}s` : ''
          labels.push(<Tag key="reader" at={[SPOT.reader.x, READER.h + 1.3, 0]} label={`You${waited}`} danger={!!waited && sim.metrics.lastWait > 4} />)
        }
        if (tags.has('queue') && sim.metrics.queue > 1) {
          labels.push(<Tag key="queue" at={[SPOT.store.x, STORE.h + 1.7, 0]} label={`${sim.metrics.queue} waiting`} danger={sim.metrics.queue > 10} />)
        }
        if (tags.has('backlog') && showInbox && sim.metrics.backlog > 1) {
          labels.push(
            <Tag key="backlog" at={[SPOT.inbox.x, INBOX.h + 1.7, SPOT.inbox.z]} label={`${sim.metrics.backlog} writes waiting`} danger={sim.metrics.backlog > 40} />,
          )
        }

        return (
          <>
            {solids.map((s) => s.node)}

            {sim.msgs.map((m) => {
              const { x, z, p } = place(m)
              const k = (m.kind === 'post' ? 0.24 : 0.2) * c.scale
              return (
                <IsoBox
                  key={m.id}
                  x={x}
                  z={z}
                  y={FLY_Y + Math.sin(p * Math.PI) * 0.4}
                  w={k}
                  d={k}
                  h={k}
                  fill={fillOf(m)}
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

// A person you follow: a small user tile with one figure. The celebrity is taller and darker.
function Person({ x, z, star = false }: { x: number; z: number; star?: boolean }) {
  const fill = star ? STAR : 'var(--muted)'
  const body = star ? 0.62 : 0.38
  const [hx, hy] = project([x, 0.06 + body + 0.12, z])
  return (
    <g>
      <IsoBox x={x} z={z} w={AUTHOR.w} d={AUTHOR.d} h={0.06} stroke="var(--line)" />
      <IsoBox x={x} z={z} y={0.06} w={star ? 0.24 : 0.17} d={star ? 0.24 : 0.17} h={body} fill={fill} />
      <circle cx={hx} cy={hy} r={(star ? 0.14 : 0.1) * S} fill={fill} />
    </g>
  )
}

// The post store: a cylinder with the lookup in progress on top and the
// lookups waiting beside it.
function Store({ sim }: { sim: FanoutSim }) {
  const waiting = sim.storeQueue.slice(0, MAX_WAITING)
  return (
    <g>
      <IsoCylinder x={SPOT.store.x} z={0} r={STORE.r} h={STORE.h} />
      {sim.busy && <IsoBox x={SPOT.store.x} z={0} y={STORE.h} w={0.3} d={0.3} h={0.3} />}
      {waiting.map((_, i) => (
        <IsoBox key={i} x={SPOT.store.x} z={1.5 + i * 0.34} w={0.26} d={0.26} h={0.26} />
      ))}
    </g>
  )
}

// The inboxes: a low slab with the write in progress on top and the writes
// waiting beside it. A celebrity's writes are dark, so a long line of them shows.
function Inboxes({ sim }: { sim: FanoutSim }) {
  const waiting = sim.writeQueue.slice(0, MAX_WAITING)
  return (
    <g>
      <IsoBox x={SPOT.inbox.x} z={SPOT.inbox.z} w={INBOX.w} d={INBOX.d} h={INBOX.h} />
      {sim.busyWrite && <IsoBox x={SPOT.inbox.x} z={SPOT.inbox.z} y={INBOX.h} w={0.26} d={0.26} h={0.26} />}
      {waiting.map((_, i) => (
        <IsoBox key={i} x={SPOT.inbox.x + 1.6 + i * 0.34} z={SPOT.inbox.z} w={0.26} d={0.26} h={0.26} />
      ))}
    </g>
  )
}

// You: a phone with your feed stacked on top, newest post highest.
function Reader({ sim }: { sim: FanoutSim }) {
  return (
    <g>
      <IsoBox x={SPOT.reader.x} z={0} w={READER.w} d={READER.d} h={READER.h} />
      {[...sim.feed].reverse().map((star, i) => (
        <IsoBox key={i} x={SPOT.reader.x} z={0} y={READER.h + i * 0.17} w={0.5} d={0.6} h={0.14} fill={star ? STAR : undefined} />
      ))}
    </g>
  )
}
