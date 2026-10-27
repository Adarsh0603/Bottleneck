import type { ReactNode } from 'react'
import { depth, project, S } from '../../core/iso/geometry'
import { edge, glide } from '../../core/iso/crowd'
import { IsoBox, Tag } from '../../core/iso/primitives'
import Viewport from '../../core/iso/Viewport'
import type { SceneProps, V3 } from '../../core/types'
import { CAP_PER_SERVER, type Msg, type RealtimeMetrics, type RealtimeSim } from './engine'
import type { Beat, RealtimeState } from './types'
import { FRIEND, MS_PER_TICK, PHONE, SERVER, SPOT } from './world'

const FLY_Y = 0.7
const LANE = 0.45 // asks travel on one side of the floor, answers on the other
const GAUGE = 2.2 // height of a full server

// The crowd: a block of small phones on the right, a column of servers in the middle.
const CROWD_COLS = 6
const CROWD_ROWS = 4
const CROWD_AT = { x: 4, z: 0 }
const SERVERS_X = -1.4

const asks = new Set<Msg['kind']>(['ask', 'open', 'reply', 'say'])

const fillOf = (m: Msg) => {
  if (m.kind === 'answer') return m.born.length ? 'var(--fg)' : undefined
  return m.kind === 'msg' || m.kind === 'push' || m.kind === 'reply' || m.kind === 'say' ? 'var(--fg)' : undefined
}

export default function Scene({ simRef, lastTickAt, st, beat, shot, shake, quiet, markers }: SceneProps<RealtimeState, RealtimeSim, Beat>) {
  const sim = simRef.current
  if (!sim) return null

  const crowd = st.phones > 1
  const bounds: V3[] = [
    [SPOT.friend.x, 2, 0],
    [SPOT.phone.x + PHONE.w, 2, 0],
  ]

  return (
    <Viewport
      target={shot.target}
      zoom={shot.zoom}
      shake={shake}
      panKey={shot}
      label={
        crowd
          ? 'Isometric view of servers on the left, each holding connections, and a crowd of phones on the right.'
          : 'Isometric view of a friend on the left, a server in the middle, and your phone on the right.'
      }
      markers={markers}
      bounds={bounds}
    >
      {({ now }) => {
        const frac = Math.min(1, Math.max(0, (now - lastTickAt.current) / MS_PER_TICK))
        const tags = new Set(beat.tags ?? [])
        const m = sim.metrics
        // On a WebSocket the friend holds a connection to the server too.
        const friendLink = sim.open && st.mode === 'ws'

        if (crowd) return <CrowdScene st={st} m={m} tags={tags} quiet={quiet} />

        const place = (msg: Msg) => {
          const a = SPOT[msg.from]
          const b = SPOT[msg.to]
          const p = glide(Math.min(1, (sim.tick - msg.sentAt + frac) / (msg.arrive - msg.sentAt)))
          return { x: a.x + (b.x - a.x) * p, z: a.z + (b.z - a.z) * p + (asks.has(msg.kind) ? LANE : -LANE), p }
        }

        const solids: { d: number; node: ReactNode }[] = [
          { d: depth(SPOT.friend.x, 0), node: <Friend key="friend" /> },
          { d: depth(SPOT.server.x, 0), node: <Server key="server" sim={sim} /> },
          { d: depth(SPOT.phone.x, 0), node: <Phone key="phone" sim={sim} /> },
        ]
        solids.sort((a, b) => a.d - b.d)

        const labels: ReactNode[] = []
        if (tags.has('parties')) {
          labels.push(<Tag key="friend" at={[SPOT.friend.x, FRIEND.h + 0.9, 0]} label="Friend" />)
          labels.push(<Tag key="server" at={[SPOT.server.x, SERVER.h + 1.2, 0]} label="Server" />)
          labels.push(<Tag key="phone" at={[SPOT.phone.x, PHONE.h + 1.6, 0]} label="Your phone" />)
        }
        if (tags.has('held') && sim.heldAt >= 0) {
          labels.push(<Tag key="held" at={[SPOT.server.x, SERVER.h + 2, 0]} label="Holding the ask" />)
        }
        if (tags.has('held') && sim.open) {
          labels.push(<Tag key="open" at={[(SPOT.server.x + SPOT.phone.x) / 2, 0.8, 0]} label="Open connection" />)
          if (friendLink) labels.push(<Tag key="friend-open" at={[(SPOT.friend.x + SPOT.server.x) / 2, 0.8, 0]} label="Friend’s connection" />)
        }

        return (
          <>
            {sim.open && <Pipe from={SPOT.server.x + SERVER.w / 2} to={SPOT.phone.x - PHONE.w / 2} />}
            {friendLink && <Pipe from={SPOT.friend.x + FRIEND.w / 2} to={SPOT.server.x - SERVER.w / 2} />}
            {solids.map((s) => s.node)}

            {sim.msgs.map((msg) => {
              const { x, z, p } = place(msg)
              const k = 0.24
              return (
                <IsoBox
                  key={msg.id}
                  x={x}
                  z={z}
                  y={FLY_Y + Math.sin(p * Math.PI) * 0.4}
                  w={k}
                  d={k}
                  h={k}
                  fill={fillOf(msg)}
                  opacity={edge(p)}
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

// The friend: a small tile with one figure.
function Friend() {
  const [hx, hy] = project([SPOT.friend.x, 0.06 + 0.38 + 0.12, 0])
  return (
    <g>
      <IsoBox x={SPOT.friend.x} z={0} w={FRIEND.w} d={FRIEND.d} h={0.06} stroke="var(--line)" />
      <IsoBox x={SPOT.friend.x} z={0} y={0.06} w={0.17} d={0.17} h={0.38} fill="var(--muted)" />
      <circle cx={hx} cy={hy} r={0.1 * S} fill="var(--muted)" />
    </g>
  )
}

// The server, with the messages waiting for the phone beside it, and the
// phone's ask on top while it is held.
function Server({ sim }: { sim: RealtimeSim }) {
  return (
    <g>
      <IsoBox x={SPOT.server.x} z={0} w={SERVER.w} d={SERVER.d} h={SERVER.h} />
      {sim.heldAt >= 0 && <IsoBox x={SPOT.server.x} z={0} y={SERVER.h} w={0.3} d={0.3} h={0.3} />}
      {sim.inbox.slice(0, 6).map((_, i) => (
        <IsoBox key={i} x={SPOT.server.x} z={1.5 + i * 0.34} w={0.26} d={0.26} h={0.26} fill="var(--fg)" />
      ))}
    </g>
  )
}

// A phone, with the messages it has shown stacked on top, newest highest.
function Phone({ sim }: { sim: RealtimeSim }) {
  return (
    <g>
      <IsoBox x={SPOT.phone.x} z={0} w={PHONE.w} d={PHONE.d} h={PHONE.h} />
      {Array.from({ length: sim.screen }, (_, i) => (
        <IsoBox key={i} x={SPOT.phone.x} z={0} y={PHONE.h + i * 0.17} w={0.5} d={0.6} h={0.14} fill="var(--fg)" />
      ))}
    </g>
  )
}

// An open connection: a flat strip from the server to the phone.
function Pipe({ from, to }: { from: number; to: number }) {
  return <IsoBox x={(from + to) / 2} z={0} w={to - from} d={0.2} h={0.06} />
}

// Many phones: a column of servers, each with a gauge of the connections it
// holds (solid: live, dim: dead ones it has not noticed yet), and a block of
// phones that are either connected or waiting to be.
function CrowdScene({ st, m, tags, quiet }: { st: RealtimeState; m: RealtimeMetrics; tags: Set<string>; quiet: boolean }) {
  const k = st.servers
  const serverZ = (i: number) => (i - (k - 1) / 2) * 1.9
  const live = Math.min(GAUGE, (m.connected / k / CAP_PER_SERVER) * GAUGE)
  const gone = Math.min(GAUGE - live, (m.dead / k / CAP_PER_SERVER) * GAUGE)
  const total = CROWD_COLS * CROWD_ROWS
  const connected = Math.round((total * m.connected) / st.phones)

  const solids: { d: number; node: ReactNode }[] = []
  for (let i = 0; i < k; i++) {
    const z = serverZ(i)
    solids.push({
      d: depth(SERVERS_X, z),
      node: (
        <g key={`s${i}`}>
          <IsoBox x={SERVERS_X} z={z} w={SERVER.w} d={SERVER.d} h={SERVER.h} />
          <IsoBox x={SERVERS_X + 1.3} z={z} w={0.5} d={0.5} h={GAUGE} ghost />
          {live > 0.02 && <IsoBox x={SERVERS_X + 1.3} z={z} w={0.5} d={0.5} h={live} fill="var(--fg)" />}
          {gone > 0.02 && <IsoBox x={SERVERS_X + 1.3} z={z} y={live} w={0.5} d={0.5} h={gone} dim />}
        </g>
      ),
    })
  }
  for (let i = 0; i < total; i++) {
    const x = CROWD_AT.x + (i % CROWD_COLS) * 0.8
    const z = (Math.floor(i / CROWD_COLS) - (CROWD_ROWS - 1) / 2) * 0.9
    solids.push({ d: depth(x, z), node: <IsoBox key={`p${i}`} x={x} z={z} w={0.45} d={0.45} h={0.7} ghost={i >= connected} /> })
  }
  solids.sort((a, b) => a.d - b.d)

  const labels: ReactNode[] = []
  if (tags.has('crowd')) {
    labels.push(<Tag key="servers" at={[SERVERS_X, SERVER.h + 1, serverZ(0) - 1.1]} label={k > 1 ? `${k} servers` : 'Server'} />)
    labels.push(<Tag key="phones" at={[CROWD_AT.x + 2, 1.9, -2.7]} label={`${st.phones.toLocaleString()} phones`} />)
    if (m.waiting > 0) labels.push(<Tag key="waiting" at={[CROWD_AT.x + 2, 1.5, 2.7]} label={`${m.waiting.toLocaleString()} waiting`} danger />)
  }
  return (
    <>
      {solids.map((s) => s.node)}
      {!quiet && labels}
    </>
  )
}
