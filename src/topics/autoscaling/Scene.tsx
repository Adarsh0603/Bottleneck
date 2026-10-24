import { useRef, type ReactNode } from 'react'
import { Piece } from '../../core/build/pieces'
import { depth } from '../../core/iso/geometry'
import { Crowd, FloorPath, FloorSpot, IsoBox, Tag } from '../../core/iso/primitives'
import { crowd, edge, glide } from '../../core/iso/crowd'
import Viewport from '../../core/iso/Viewport'
import type { SceneProps, V3 } from '../../core/types'
import type { AutoscaleSim } from './engine'
import type { AutoscaleState, Beat } from './types'
import { LB, MAX_SERVERS, MS_PER_TICK, SERVER, SERVER_X, slotZ, spotOf, TICKS_PER_SECOND, USERS } from './world'

const CUBE = 0.22
const FLY_Y = 0.55
const FALL_SECONDS = 1.2
const RISE_MS = 800
const ROW_END = slotZ(5) + 1.4
const ROW_START = slotZ(4) - 1.4

export default function Scene({ simRef, lastTickAt, st, beat, shot, shake, quiet, markers }: SceneProps<AutoscaleState, AutoscaleSim, Beat>) {
  const born = useRef(new Map<string, number>())
  const sim = simRef.current
  if (!sim) return null

  return (
    <Viewport target={shot.target} zoom={shot.zoom} shake={shake} panKey={shot} label="Users, a load balancer, and a fleet of servers that grows and shrinks." markers={markers}>
      {({ now }) => {
        const flow = sim.flow
        const frac = Math.min(1, Math.max(0, (now - lastTickAt.current) / MS_PER_TICK))
        const c = crowd(flow.inTransit.length)
        const m = sim.metrics
        const tags = new Set(beat.tags ?? [])
        const riseOf = (key: string) => {
          if (!born.current.has(key)) born.current.set(key, now)
          const t = Math.min(1, (now - born.current.get(key)!) / RISE_MS)
          return 1 - Math.pow(1 - t, 3)
        }

        const routes: V3[][] = [
          [
            [USERS.x + 1, 0, USERS.z],
            [LB.x - 0.65, 0, LB.z],
          ],
        ]
        const pads: ReactNode[] = []
        const solids: { d: number; node: ReactNode }[] = [
          { d: depth(USERS.x, USERS.z), node: <Crowd key="users" x={USERS.x} z={USERS.z} active={Math.round(m.rps)} /> },
          { d: depth(LB.x, LB.z), node: <Piece key="lb" kind="balancer" x={LB.x} z={LB.z} /> },
        ]
        const labels: ReactNode[] = []

        for (let i = 0; i < MAX_SERVERS; i++) {
          const z = slotZ(i)
          const slot = sim.slots[i]
          const key = `slot-${i}`
          if (!slot) {
            born.current.delete(key)
            pads.push(<FloorSpot key={key} x={SERVER_X} z={z} size={SERVER.w} />)
            continue
          }
          const top: V3 = [SERVER_X, SERVER.h + 0.5, z]
          if (slot.state === 'booting') {
            // A dashed outline, filling up as it boots.
            const p = Math.min(1, (sim.tick - slot.startedAt + frac) / Math.max(1, slot.readyAt - slot.startedAt))
            solids.push({
              d: depth(SERVER_X, z),
              node: (
                <g key={key}>
                  <IsoBox x={SERVER_X} z={z} w={SERVER.w} d={SERVER.w} h={SERVER.h} ghost />
                  <IsoBox x={SERVER_X} z={z} w={SERVER.w} d={SERVER.w} h={SERVER.h * p} dim />
                </g>
              ),
            })
            if (tags.has('servers')) {
              const left = Math.ceil((slot.readyAt - sim.tick) / TICKS_PER_SECOND)
              labels.push(<Tag key={key} at={top} label={`Booting · ${left}s`} />)
            }
            continue
          }
          if (slot.state === 'draining') {
            solids.push({ d: depth(SERVER_X, z), node: <IsoBox key={key} x={SERVER_X} z={z} w={SERVER.w} d={SERVER.w} h={SERVER.h} dim stroke="var(--muted)" /> })
            if (tags.has('servers')) labels.push(<Tag key={key} at={top} label="Shutting down" />)
            continue
          }
          routes.push([
            [LB.x + 0.65, 0, LB.z],
            [SERVER_X - SERVER.w / 2, 0, z],
          ])
          solids.push({ d: depth(SERVER_X, z), node: <Piece key={key} kind="server" x={SERVER_X} z={z} node={slot.worker} rise={riseOf(key)} /> })
          const w = slot.worker
          if (tags.has('servers') && w.queue.length >= w.queueLimit * 0.75) labels.push(<Tag key={key} at={top} label="Full" danger />)
        }
        solids.sort((a, b) => a.d - b.d)

        if (tags.has('users')) labels.push(<Tag key="users" at={[USERS.x, 1, USERS.z]} label="Users" />)
        if (tags.has('lb')) labels.push(<Tag key="lb" at={[LB.x, 1, LB.z]} label="Load balancer" />)
        if (tags.has('autoscaler')) {
          labels.push(<Tag key="autoscaler" at={[SERVER_X, 0.2, ROW_START]} label={st.auto ? `Autoscaler · aim ${st.target}% busy` : 'Fixed fleet'} />)
        }
        if (tags.has('idle')) {
          const busy = Math.round(m.busy * 100)
          labels.push(<Tag key="idle" at={[SERVER_X, 0.2, ROW_END]} label={busy < 30 ? `Mostly idle · ${busy}% busy` : `${busy}% busy`} />)
        }

        return (
          <>
            {pads}
            {routes.map((route, i) => (
              <FloorPath key={i} route={route} />
            ))}
            {solids.map((s) => s.node)}

            {/* Requests on their way. */}
            {flow.inTransit.map((t) => {
              const a = spotOf(t.from)
              const b = spotOf(t.to)
              if (!a || !b) return null
              const p = glide(Math.min(1, t.progress + frac / t.ticks))
              const x = a.x + (b.x - a.x) * p
              const z = a.z + (b.z - a.z) * p
              return <IsoBox key={t.job.id} x={x} z={z} y={FLY_Y + Math.sin(p * Math.PI) * 0.3} w={CUBE * c.scale} d={CUBE * c.scale} h={CUBE * c.scale} fill="var(--fg)" opacity={c.opacity * edge(p)} />
            })}

            {/* Turned away: red cubes tumble off the full server. */}
            {flow.recentDrops.map((d) => {
              const at = spotOf(d.node)
              const age = (sim.tick - d.tick + frac) / TICKS_PER_SECOND
              if (!at || age > FALL_SECONDS) return null
              const side = d.jobId % 2 === 0 ? 1 : -1
              return (
                <IsoBox
                  key={`drop-${d.jobId}`}
                  x={at.x - 0.9 - age * 0.6}
                  z={at.z + side * (0.15 + age * 0.9)}
                  y={FLY_Y + age * 1.2 - 5 * age * age}
                  w={CUBE}
                  d={CUBE}
                  h={CUBE}
                  fill="var(--danger)"
                  opacity={1 - age / FALL_SECONDS}
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
