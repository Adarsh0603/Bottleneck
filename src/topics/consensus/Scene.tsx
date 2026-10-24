import type { ReactNode } from 'react'
import { depth } from '../../core/iso/geometry'
import { crowd, edge, glide } from '../../core/iso/crowd'
import { IsoBox, IsoCylinder, Tag } from '../../core/iso/primitives'
import Viewport from '../../core/iso/Viewport'
import type { SceneProps, V3 } from '../../core/types'
import type { ConsensusSim, Msg, Node } from './engine'
import type { Beat, ConsensusState } from './types'
import { above, CLIENT_COLOR, CLIENT_NAMES, CLIENTS, clientSpot, MS_PER_TICK, NODE, nodeSpot, spotOf, TICKS_PER_SECOND } from './world'

const FLY_Y = 0.7
const LEDGER_SLOTS = 5
const CLASH_SECONDS = 2

// How a message on the wire looks: a booking is a customer-coloured cube, a
// heartbeat a small grey one, a vote a purple one.
function look(m: Msg): { size: number; fill?: string; stroke?: string } {
  switch (m.kind) {
    case 'book':
    case 'copy':
      return { size: m.kind === 'book' ? 0.24 : 0.18, fill: CLIENT_COLOR[m.kind === 'book' ? m.who : m.entry.who] }
    case 'answer':
      return { size: 0.22, fill: m.ok ? CLIENT_COLOR[m.who] : 'var(--danger)' }
    case 'append':
      return m.entries.length ? { size: 0.18, fill: 'var(--fg)' } : { size: 0.1, fill: 'var(--muted)' }
    case 'appendReply':
      return { size: 0.1, fill: m.ok ? 'var(--muted)' : 'var(--danger)' }
    case 'vote':
      return { size: 0.18, fill: 'var(--srv-4)' }
    case 'voteReply':
      return { size: 0.14, fill: m.granted ? 'var(--srv-3)' : 'var(--danger)' }
  }
}

export default function Scene({ simRef, lastTickAt, st, beat, shot, shake, quiet, markers }: SceneProps<ConsensusState, ConsensusSim, Beat>) {
  const sim = simRef.current
  if (!sim) return null

  // Frame both customers and every server in the ring.
  const bounds: V3[] = [
    ...CLIENTS.map((c): V3 => [clientSpot(c).x, 1.5, clientSpot(c).z]),
    ...sim.active.map((n) => above(n.id, st.size, 1)),
  ]

  return (
    <Viewport
      target={shot.target}
      zoom={shot.zoom}
      shake={shake}
      panKey={shot}
      label="Isometric view of a ring of servers, each with a ledger of seat bookings, and two customers on the left."
      markers={markers}
      bounds={bounds}
    >
      {({ now }) => {
        const frac = Math.min(1, Math.max(0, (now - lastTickAt.current) / MS_PER_TICK))
        const c = crowd(sim.msgs.length)
        const tags = new Set(beat.tags ?? [])
        const size = st.size
        const leaderMode = st.rule === 'leader'

        const solids: { d: number; node: ReactNode }[] = []
        for (const client of CLIENTS) {
          const s = clientSpot(client)
          solids.push({ d: depth(s.x, s.z), node: <IsoBox key={`c-${client}`} x={s.x} z={s.z} w={0.7} d={0.7} h={1.2} fill={CLIENT_COLOR[client]} /> })
        }
        for (const n of sim.active) {
          const s = nodeSpot(n.id, size)
          solids.push({ d: depth(s.x, s.z), node: <Server key={`n-${n.id}`} n={n} size={size} leaderMode={leaderMode} /> })
        }
        solids.sort((a, b) => a.d - b.d)

        const labels: ReactNode[] = []
        if (tags.has('clients')) {
          for (const client of CLIENTS) {
            const s = clientSpot(client)
            labels.push(<Tag key={`cl-${client}`} at={[s.x, 1.5, s.z]} label={CLIENT_NAMES[client]} color={CLIENT_COLOR[client]} />)
          }
        }
        if (tags.has('nodes') || tags.has('leader') || tags.has('terms') || tags.has('timers') || tags.has('split')) {
          for (const n of sim.active) {
            const parts: string[] = []
            if (tags.has('nodes')) parts.push(`Server ${n.id + 1}`)
            const cut = n.id >= st.size - st.split
            const status = !n.alive ? 'Crashed' : leaderMode && n.role === 'leader' ? 'Leader' : n.role === 'candidate' ? 'Candidate' : ''
            if (tags.has('leader') && status) parts.push(status)
            if (tags.has('terms') && n.alive && n.term > 0) parts.push(`Term ${n.term}`)
            if (tags.has('timers') && n.alive && n.role === 'follower' && st.elections) parts.push(`${(n.timer / TICKS_PER_SECOND).toFixed(1)} s`)
            if (tags.has('split') && n.alive && cut) parts.push('Cut off')
            if (parts.length) labels.push(<Tag key={`t-${n.id}`} at={above(n.id, size, n.role === 'leader' && n.alive ? 1 : 0.7)} label={parts.join(' · ')} danger={!n.alive || (tags.has('split') && cut)} />)
          }
        }
        if (tags.has('holders')) {
          const newest = sim.newest
          if (newest) {
            for (const n of sim.active) {
              if (!n.alive) continue
              const has = n.log.some((e) => e.req === newest.req)
              const s = nodeSpot(n.id, size)
              labels.push(<Tag key={`has-${n.id}`} at={[s.x, 0.25, s.z]} label={has ? 'Has it' : 'Missing it'} danger={!has} />)
            }
          }
        }
        if (tags.has('votes')) {
          // One 'Vote for me?' per candidate, so a round of requests reads as one ask.
          const asked = new Set<number>()
          for (const m of sim.msgs) {
            if (m.kind !== 'vote' && m.kind !== 'voteReply') continue
            if (m.kind === 'vote') {
              if (asked.has(m.from)) continue
              asked.add(m.from)
            }
            const a = spotOf(m.from, size)
            const b = spotOf(m.to, size)
            const p = glide(Math.min(1, (sim.tick - m.sentAt + frac) / (m.arrive - m.sentAt)))
            const label = m.kind === 'vote' ? 'Vote for me?' : m.granted ? 'Yes' : 'No'
            labels.push(<Tag key={`vote-${m.id}`} at={[a.x + (b.x - a.x) * p, FLY_Y + Math.sin(p * Math.PI) * 0.4 + 0.3, a.z + (b.z - a.z) * p]} label={label} danger={m.kind === 'voteReply' && !m.granted} />)
          }
        }
        for (const m of beat.noCopyLabel ? [] : sim.msgs) {
          if (m.kind !== 'append' || !m.entries.length) continue
          const a = spotOf(m.from, size)
          const b = spotOf(m.to, size)
          const p = glide(Math.min(1, (sim.tick - m.sentAt + frac) / (m.arrive - m.sentAt)))
          labels.push(<Tag key={`copy-${m.id}`} at={[a.x + (b.x - a.x) * p, FLY_Y + Math.sin(p * Math.PI) * 0.4 + 0.3, a.z + (b.z - a.z) * p]} label="Copying" />)
        }
        if (tags.has('heartbeat')) {
          for (const m of sim.msgs) {
            if (m.kind !== 'append' || m.entries.length) continue
            const a = spotOf(m.from, size)
            const b = spotOf(m.to, size)
            const p = glide(Math.min(1, (sim.tick - m.sentAt + frac) / (m.arrive - m.sentAt)))
            labels.push(<Tag key={`beat-${m.id}`} at={[a.x + (b.x - a.x) * p, FLY_Y + Math.sin(p * Math.PI) * 0.4 + 0.3, a.z + (b.z - a.z) * p]} label="Heartbeat" />)
          }
        }
        if (tags.has('clash')) {
          const last = sim.clashEvents[sim.clashEvents.length - 1]
          if (last && (st.manual || (sim.tick - last.tick) / TICKS_PER_SECOND < CLASH_SECONDS)) {
            labels.push(<Tag key="clash" at={[0, 2, 0]} label={`Seat ${last.seat} sold twice`} danger />)
          }
        }

        return (
          <>
            {solids.map((s) => s.node)}

            {sim.msgs.map((m) => {
              const a = spotOf(m.from, size)
              const b = spotOf(m.to, size)
              const p = glide(Math.min(1, (sim.tick - m.sentAt + frac) / (m.arrive - m.sentAt)))
              const l = look(m)
              const k = l.size * c.scale
              return (
                <IsoBox
                  key={m.id}
                  x={a.x + (b.x - a.x) * p}
                  z={a.z + (b.z - a.z) * p}
                  y={FLY_Y + Math.sin(p * Math.PI) * 0.4}
                  w={k}
                  d={k}
                  h={k}
                  fill={l.fill}
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

// A server: a drum with its ledger on the lid, one small block per booking.
// A leader wears a crown; a block fades until a majority holds it.
function Server({ n, size, leaderMode }: { n: Node; size: number; leaderMode: boolean }) {
  const s = nodeSpot(n.id, size)
  const stroke = !n.alive ? 'var(--danger)' : n.role === 'candidate' ? 'var(--srv-4)' : 'var(--fg)'
  const shown = n.log.slice(-LEDGER_SLOTS)
  return (
    <g>
      <IsoCylinder x={s.x} z={s.z} r={NODE.r} h={NODE.h} stroke={stroke} dim={!n.alive} />
      {n.alive &&
        shown.map((e, i) => (
          <IsoBox
            key={e.req}
            x={s.x + (i - (LEDGER_SLOTS - 1) / 2) * 0.27}
            z={s.z}
            y={NODE.h}
            w={0.22}
            d={0.22}
            h={0.22}
            fill={e.clash ? 'var(--danger)' : CLIENT_COLOR[e.who]}
            opacity={leaderMode && e.idx > n.commit ? 0.4 : 1}
          />
        ))}
      {n.alive && leaderMode && n.role === 'leader' && <IsoBox x={s.x} z={s.z} y={NODE.h + 0.3} w={0.5} d={0.5} h={0.22} fill="var(--srv-5)" />}
    </g>
  )
}
