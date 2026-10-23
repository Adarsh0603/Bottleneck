import { useRef, type ReactNode } from 'react'
import { depth, points, project, S } from '../../core/iso/geometry'
import { FloorPath, FloorSpot, IsoBox, Tag } from '../../core/iso/primitives'
import Viewport from '../../core/iso/Viewport'
import type { SceneProps, V3 } from '../../core/types'
import type { LoadBalancerSim, Server } from './engine'
import { buildTags } from './tags'
import type { Beat, CourseState } from './types'
import { MS_PER_TICK, TICKS_PER_SECOND } from './useSim'
import {
  BASE,
  CUBE,
  dropOrigin,
  dropPoint,
  FALL_SECONDS,
  isOverloaded,
  LB_SIZE,
  LB_X,
  lbZ,
  PATH_START,
  queueSpot,
  scaleOf,
  SERVER_X,
  serverFront,
  serverZ,
  SLOT,
  STANDBY_Z,
  transitPoint,
  USERS_X,
} from './world'

const RISE_MS = 900

export default function Scene({ simRef, lastTickAt, st, beat, shot, shake, update }: SceneProps<CourseState, LoadBalancerSim, Beat>) {
  // When each object first appeared (for rising), and its current size.
  const born = useRef(new Map<string, number>())
  const sizes = useRef(new Map<number, number>())

  const sim = simRef.current
  if (!sim) return null

  // Zoom out further when many servers are on screen.
  const count = sim.servers.length
  const extent = ((count - 1) * 2.3) / 2 + 0.75
  const zoom = shot.zoom * (shot.fit ? Math.min(1, 4.2 / extent) : 1)

  const toggleServer = (i: number) =>
    update((p) => ({ down: p.down.includes(i) ? p.down.filter((d) => d !== i) : [...p.down, i] }))

  return (
    <Viewport target={shot.target} zoom={zoom} shake={shake} panKey={shot} label="Isometric view of the system.">
      {({ now, dt }) => {
        const ease = (speed: number) => 1 - Math.exp(-dt * speed)
        const riseOf = (key: string) => {
          if (!born.current.has(key)) born.current.set(key, now)
          const t = Math.min(1, (now - born.current.get(key)!) / RISE_MS)
          return 1 - Math.pow(1 - t, 3)
        }

        const limit = sim.config.queueLimit
        const lbz = lbZ(st.failover)
        const balancer = sim.algorithm !== 'direct'
        const tags = buildTags(sim, beat)
        const frac = Math.min(1, Math.max(0, (now - lastTickAt.current) / MS_PER_TICK))

        // Solid objects, painted back to front.
        const solids: { d: number; node: ReactNode }[] = []

        sim.servers.forEach((server, i) => {
          const prev = sizes.current.get(server.id) ?? scaleOf(server.speed)
          const k = prev + (scaleOf(server.speed) - prev) * ease(3)
          sizes.current.set(server.id, k)
          const z = serverZ(i, count)
          const overloaded = isOverloaded(server, limit)
          solids.push({
            d: depth(SERVER_X, z),
            node: (
              <ServerBox
                key={`s${server.id}`}
                server={server}
                z={z}
                k={k}
                rise={riseOf(`s${server.id}`)}
                overloaded={overloaded}
                onClick={beat.clickCrash ? () => toggleServer(i) : undefined}
              />
            ),
          })
          server.queue.forEach((job, q) => {
            const [x, , qz] = queueSpot(server.speed, i, count, q)
            solids.push({
              d: depth(x, qz),
              node: (
                <IsoBox key={`q${job.id}`} x={x} z={qz} w={CUBE} d={CUBE} h={CUBE} fill={overloaded ? 'var(--danger)' : 'var(--fg)'} />
              ),
            })
          })
        })

        if (balancer) {
          solids.push({
            d: depth(LB_X, 0),
            node: <LbBox key="lb0" z={0} mode={st.failover ? 'down' : 'active'} rise={riseOf('lb0')} />,
          })
          if (st.standby) {
            solids.push({
              d: depth(LB_X, STANDBY_Z),
              node: <LbBox key="lb1" z={STANDBY_Z} mode={st.failover ? 'active' : 'standby'} rise={riseOf('lb1')} />,
            })
          }
        }
        solids.push({ d: depth(USERS_X, 0), node: <Users key="users" rps={st.rps} /> })
        solids.sort((a, b) => a.d - b.d)

        // Labels, drawn last so nothing covers them.
        const labels: ReactNode[] = []
        if (tags.users) labels.push(<Tag key="users" at={[USERS_X, 1, 0]} label="Users" />)
        if (balancer && st.failover) labels.push(<Tag key="lbdown" at={[LB_X, 1, 0]} label="Down" danger />)
        if (balancer && tags.lb) labels.push(<Tag key="lb" at={[LB_X, 1, lbz]} label={tags.lb.label} danger={tags.lb.danger} />)
        if (balancer && st.standby && !st.failover && tags.standby) {
          labels.push(<Tag key="standby" at={[LB_X, 1, STANDBY_Z]} label={tags.standby.label} />)
        }
        sim.servers.forEach((server, i) => {
          const z = serverZ(i, count)
          const top = BASE.h * scaleOf(server.speed) + 0.6
          tags.servers[i].forEach((t, n) => {
            const at: V3 =
              t.at === 'queue'
                ? [queueSpot(server.speed, i, count, (limit - 1) / 2)[0], 0.7, z]
                : t.at === 'end'
                  ? [queueSpot(server.speed, i, count, limit)[0] - 0.4, 1.2, z]
                  : [SERVER_X, top + n * 0.6, z]
            labels.push(<Tag key={`${server.id}-${t.label}`} at={at} label={t.label} danger={t.danger} />)
          })
        })
        if (beat.ghost) labels.push(<Tag key="ceiling" at={[SERVER_X, BASE.h * scaleOf(8) + 0.5, 0]} label="Biggest machine sold" />)

        const routes: V3[][] = balancer
          ? [
              [
                [PATH_START, 0, 0],
                [LB_X - LB_SIZE.w / 2, 0, lbz],
              ],
              ...sim.servers.map((s, i): V3[] => [
                [LB_X + LB_SIZE.w / 2, 0, lbz],
                [serverFront(s.speed), 0, serverZ(i, count)],
              ]),
            ]
          : sim.servers.slice(0, 1).map((s): V3[] => [
              [PATH_START, 0, 0],
              [serverFront(s.speed), 0, serverZ(0, count)],
            ])

        return (
          <>
            {routes.map((route, i) => (
              <FloorPath key={i} route={route} />
            ))}

            {sim.servers.map((server, i) =>
              Array.from({ length: limit }, (_, q) => {
                const [x, , z] = queueSpot(server.speed, i, count, q)
                return <FloorSpot key={`${server.id}-${q}`} x={x} z={z} size={CUBE + 0.08} />
              }),
            )}

            {beat.ghost && (
              <IsoBox x={SERVER_X} z={0} w={BASE.w * scaleOf(8)} d={BASE.d * scaleOf(8)} h={BASE.h * scaleOf(8)} ghost />
            )}

            {solids.map((s) => s.node)}

            {/* Requests in flight. */}
            {sim.inTransit.map((t) => {
              const p = Math.min(1, t.progress + frac / sim.config.transitTicks)
              const at = transitPoint(sim, t, p, lbz)
              if (!at) return null
              return <IsoBox key={t.job.id} x={at[0]} z={at[2]} y={at[1] - CUBE / 2} w={CUBE} d={CUBE} h={CUBE} fill="var(--fg)" />
            })}

            {/* Dropped requests tumble and fade. */}
            {sim.recentDrops.map((d) => {
              const age = (sim.tick - d.tick + frac) / TICKS_PER_SECOND
              if (age > FALL_SECONDS) return null
              const [x, y, z] = dropPoint(dropOrigin(sim, d.serverId), age, d.jobId)
              return (
                <IsoBox
                  key={`drop-${d.jobId}`}
                  x={x}
                  z={z}
                  y={y}
                  w={CUBE}
                  d={CUBE}
                  h={CUBE}
                  fill="var(--danger)"
                  opacity={1 - age / FALL_SECONDS}
                />
              )
            })}

            {labels}
          </>
        )
      }}
    </Viewport>
  )
}

function ServerBox({
  server,
  z,
  k,
  rise,
  overloaded,
  onClick,
}: {
  server: Server
  z: number
  k: number
  rise: number
  overloaded: boolean
  onClick?: () => void
}) {
  const w = BASE.w * k
  const d = BASE.d * k
  const h = BASE.h * k * rise
  const stroke = !server.alive ? 'var(--muted)' : overloaded ? 'var(--danger)' : 'var(--fg)'
  const x0 = SERVER_X - w / 2
  const slot = SLOT * k

  const slots = Array.from({ length: server.slots }, (_, s) => ({
    s,
    x: SERVER_X + ((s % 2) - 0.5) * 0.56 * k,
    z: z + (Math.floor(s / 2) - 0.5) * 0.56 * k,
  })).sort((a, b) => depth(a.x, a.z) - depth(b.x, b.z))

  return (
    <g onClick={onClick} className={onClick ? 'cursor-pointer' : undefined}>
      <IsoBox x={SERVER_X} z={z} w={w} d={d} h={h} stroke={stroke} dim={!server.alive} />
      {rise === 1 &&
        [0.2, 0.375, 0.55, 0.725].map((f) => (
          <polyline
            key={f}
            points={points([
              [x0, BASE.h * k * f, z - d * 0.32],
              [x0, BASE.h * k * f, z + d * 0.32],
            ])}
            stroke="var(--line)"
            strokeWidth={3}
            strokeLinecap="round"
          />
        ))}
      {rise === 1 &&
        server.alive &&
        slots.map((s) => (
          <IsoBox
            key={s.s}
            x={s.x}
            z={s.z}
            y={h}
            w={slot}
            d={slot}
            h={slot}
            fill={s.s < server.active.length ? 'var(--fg)' : undefined}
          />
        ))}
    </g>
  )
}

function LbBox({ z, mode, rise }: { z: number; mode: 'active' | 'standby' | 'down'; rise: number }) {
  const h = LB_SIZE.h * rise
  if (mode === 'standby') return <IsoBox x={LB_X} z={z} w={LB_SIZE.w} d={LB_SIZE.d} h={h} ghost />
  if (mode === 'down') return <IsoBox x={LB_X} z={z} w={LB_SIZE.w} d={LB_SIZE.d} h={h} dim stroke="var(--muted)" />
  const [cx, cy] = project([LB_X, h, z])
  return (
    <g>
      <IsoBox x={LB_X} z={z} w={LB_SIZE.w} d={LB_SIZE.d} h={h} fill="var(--fg)" />
      {rise === 1 && (
        <g transform={`translate(${cx} ${cy})`} stroke="var(--bg)" strokeWidth={2.5} strokeLinecap="round" fill="none">
          <path d="M-14 6 L0 0 M0 0 L14 -10 M0 0 L16 0 M0 0 L10 10" />
        </g>
      )}
    </g>
  )
}

const COLS = 4
const ROWS = 3

function Users({ rps }: { rps: number }) {
  const active = Math.round(rps)
  const people = Array.from({ length: COLS * ROWS }, (_, i) => ({
    i,
    x: USERS_X + ((i % COLS) - (COLS - 1) / 2) * 0.42,
    z: (Math.floor(i / COLS) - (ROWS - 1) / 2) * 0.45,
  })).sort((a, b) => depth(a.x, a.z) - depth(b.x, b.z))

  return (
    <g>
      <IsoBox x={USERS_X} z={0} w={1.9} d={1.6} h={0.06} stroke="var(--line)" />
      {people.map((p) => {
        const color = p.i < active ? 'var(--fg)' : 'var(--iso-idle)'
        const [hx, hy] = project([p.x, 0.58, p.z])
        return (
          <g key={p.i}>
            <IsoBox x={p.x} z={p.z} y={0.06} w={0.17} d={0.17} h={0.38} fill={color} />
            <circle cx={hx} cy={hy} r={0.1 * S} fill={color} />
          </g>
        )
      })}
    </g>
  )
}
