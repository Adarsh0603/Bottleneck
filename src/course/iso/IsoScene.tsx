import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { Server } from '../../simulators/loadBalancer/engine'
import { MS_PER_TICK, TICKS_PER_SECOND } from '../../simulators/loadBalancer/useSim'
import { buildTags, type TagSpec } from '../tags'
import type { SceneProps } from '../types'
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
  type V3,
} from '../world'

// Lightweight isometric view of the same world as the 3D scene. A larger
// (z − x) is closer to the viewer, so things are painted in that order.
const S = 40
const COS = Math.cos(Math.PI / 6)
const VIEW_W = 900
const VIEW_H = 620

function project([x, y, z]: V3): [number, number] {
  return [(x + z) * COS * S, ((z - x) * 0.5 - y) * S]
}

const points = (vs: V3[]) => vs.map((v) => project(v).join(',')).join(' ')
const depth = (x: number, z: number) => z - x
const RISE_MS = 900

export default function IsoScene({ simRef, lastTickAt, st, beat, shot, shake, onServerClick }: SceneProps) {
  // Redraw every animation frame so motion is smooth between 20 Hz ticks.
  const [now, setNow] = useState(() => performance.now())
  useEffect(() => {
    let id = requestAnimationFrame(function loop(t) {
      setNow(t)
      id = requestAnimationFrame(loop)
    })
    return () => cancelAnimationFrame(id)
  }, [])

  // When each object first appeared (for rising), and its current size.
  const born = useRef(new Map<string, number>())
  const sizes = useRef(new Map<number, number>())
  const view = useRef<{ cx: number; cy: number; zoom: number } | null>(null)
  const shakeUntil = useRef(0)
  const lastFrame = useRef(now)

  useEffect(() => {
    if (shake > 0) shakeUntil.current = performance.now() + 380
  }, [shake])

  const sim = simRef.current
  if (!sim) return null

  const dt = Math.min(0.1, (now - lastFrame.current) / 1000)
  lastFrame.current = now
  const ease = (speed: number) => 1 - Math.exp(-dt * speed)
  const riseOf = (key: string) => {
    if (!born.current.has(key)) born.current.set(key, now)
    const t = Math.min(1, (now - born.current.get(key)!) / RISE_MS)
    return 1 - Math.pow(1 - t, 3)
  }

  const count = sim.servers.length
  const limit = sim.config.queueLimit
  const lbz = lbZ(st.failover)
  const balancer = sim.algorithm !== 'direct'
  const tags = buildTags(sim, beat)
  const frac = Math.min(1, Math.max(0, (now - lastTickAt.current) / MS_PER_TICK))

  // Camera: glide the viewBox toward the beat's shot.
  const extent = ((count - 1) * 2.3) / 2 + 0.75
  const zoomGoal = shot.zoom * (shot.fit ? Math.min(1, 4.2 / extent) : 1)
  const [gx, gy] = project(shot.target)
  const v = (view.current ??= { cx: gx, cy: gy, zoom: zoomGoal })
  v.cx += (gx - v.cx) * ease(3)
  v.cy += (gy - v.cy) * ease(3)
  v.zoom += (zoomGoal - v.zoom) * ease(3)
  const jx = now < shakeUntil.current ? (Math.random() - 0.5) * 10 : 0
  const jy = now < shakeUntil.current ? (Math.random() - 0.5) * 10 : 0
  const w = VIEW_W / v.zoom
  const h = VIEW_H / v.zoom

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
          onClick={beat.clickCrash && onServerClick ? () => onServerClick(i) : undefined}
        />
      ),
    })
    server.queue.forEach((job, q) => {
      const [x, , qz] = queueSpot(server.speed, i, count, q)
      solids.push({
        d: depth(x, qz),
        node: <IsoBox key={`q${job.id}`} x={x} z={qz} w={CUBE} d={CUBE} h={CUBE} fill={overloaded ? 'var(--danger)' : 'var(--fg)'} />,
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
    tags.servers[i].forEach((t: TagSpec, n) => {
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

  return (
    <svg
      viewBox={`${v.cx - w / 2 + jx} ${v.cy - h / 2 + jy} ${w} ${h}`}
      className="h-full w-full select-none"
      role="img"
      aria-label="Isometric view of the system"
    >
      <IsoGrid />

      {/* Routes on the floor. */}
      {(balancer
        ? [
            [[PATH_START, 0, 0], [LB_X - LB_SIZE.w / 2, 0, lbz]] as V3[],
            ...sim.servers.map((s, i): V3[] => [
              [LB_X + LB_SIZE.w / 2, 0, lbz],
              [serverFront(s.speed), 0, serverZ(i, count)],
            ]),
          ]
        : sim.servers.slice(0, 1).map((s): V3[] => [[PATH_START, 0, 0], [serverFront(s.speed), 0, serverZ(0, count)]])
      ).map((route, i) => (
        <polyline key={i} points={points(route)} stroke="var(--muted)" strokeWidth={1} strokeDasharray="5 5" fill="none" />
      ))}

      {/* Queue spots. */}
      {sim.servers.map((server, i) =>
        Array.from({ length: limit }, (_, q) => {
          const [x, , z] = queueSpot(server.speed, i, count, q)
          const r = (CUBE + 0.08) / 2
          return (
            <polygon
              key={`${server.id}-${q}`}
              points={points([
                [x - r, 0, z - r],
                [x - r, 0, z + r],
                [x + r, 0, z + r],
                [x + r, 0, z - r],
              ])}
              fill="var(--subtle)"
              stroke="var(--line)"
            />
          )
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
    </svg>
  )
}

function IsoBox({
  x,
  z,
  w,
  d,
  h,
  y = 0,
  fill,
  stroke = 'var(--fg)',
  opacity,
  ghost,
  dim,
}: {
  x: number
  z: number
  w: number
  d: number
  h: number
  y?: number
  fill?: string
  stroke?: string
  opacity?: number
  ghost?: boolean
  dim?: boolean
}) {
  const x0 = x - w / 2
  const x1 = x + w / 2
  const z0 = z - d / 2
  const z1 = z + d / 2
  const y1 = y + h
  const left: V3[] = [[x0, y, z0], [x0, y, z1], [x0, y1, z1], [x0, y1, z0]]
  const right: V3[] = [[x0, y, z1], [x1, y, z1], [x1, y1, z1], [x0, y1, z1]]
  const top: V3[] = [[x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0]]

  if (ghost) {
    const style = { fill: 'none', stroke: 'var(--muted)', strokeDasharray: '5 5', strokeWidth: 1 }
    return (
      <g>
        <polygon points={points(left)} {...style} />
        <polygon points={points(right)} {...style} />
        <polygon points={points(top)} {...style} />
      </g>
    )
  }

  const faces = dim
    ? ['var(--iso-idle)', 'var(--iso-idle)', 'var(--iso-idle)']
    : [fill ?? 'var(--iso-left)', fill ?? 'var(--iso-right)', fill ?? 'var(--iso-top)']
  const line = {
    stroke: fill && !dim ? 'none' : stroke,
    strokeWidth: 1.2,
    strokeLinejoin: 'round' as const,
    strokeDasharray: dim ? '4 4' : undefined,
  }

  return (
    <g opacity={opacity}>
      <polygon points={points(left)} fill={faces[0]} {...line} />
      {fill && <polygon points={points(left)} fill="#000" opacity={0.18} />}
      <polygon points={points(right)} fill={faces[1]} {...line} />
      {fill && <polygon points={points(right)} fill="#000" opacity={0.36} />}
      <polygon points={points(top)} fill={faces[2]} {...line} />
    </g>
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

function IsoGrid() {
  const lines: ReactNode[] = []
  for (let v = -14; v <= 12; v += 0.5) {
    const major = v % 2.5 === 0
    lines.push(
      <polyline
        key={`x${v}`}
        points={points([[v, 0, -10], [v, 0, 10]])}
        stroke={major ? 'var(--muted)' : 'var(--line)'}
        strokeWidth={major ? 0.8 : 0.6}
        opacity={major ? 0.45 : 1}
      />,
    )
  }
  for (let v = -10; v <= 10; v += 0.5) {
    const major = v % 2.5 === 0
    lines.push(
      <polyline
        key={`z${v}`}
        points={points([[-14, 0, v], [12, 0, v]])}
        stroke={major ? 'var(--muted)' : 'var(--line)'}
        strokeWidth={major ? 0.8 : 0.6}
        opacity={major ? 0.45 : 1}
      />,
    )
  }
  return (
    <g>
      <defs>
        <radialGradient id="iso-grid-fade" cx="50%" cy="50%" r="50%">
          <stop offset="30%" stopColor="#fff" />
          <stop offset="100%" stopColor="#000" />
        </radialGradient>
        <mask id="iso-grid-mask" maskUnits="userSpaceOnUse" x={-900} y={-600} width={1700} height={1100}>
          <rect x={-900} y={-600} width={1700} height={1100} fill="url(#iso-grid-fade)" />
        </mask>
      </defs>
      <g mask="url(#iso-grid-mask)" fill="none">
        {lines}
      </g>
    </g>
  )
}

function Tag({ at, label, danger }: { at: V3; label: string; danger?: boolean }) {
  const [sx, sy] = project(at)
  const text = label.toUpperCase()
  const w = text.length * 7.4 + 24
  const color = danger ? 'var(--danger)' : 'var(--fg)'
  return (
    <g transform={`translate(${sx} ${sy})`} className="pointer-events-none">
      <g className="tag-in">
        <line y1={0} y2={-14} stroke={color} />
        <rect x={-w / 2} y={-38} width={w} height={24} rx={12} fill={danger ? color : 'var(--bg)'} stroke={color} />
        <text y={-22} textAnchor="middle" className="font-mono" fontSize={11} letterSpacing={1} fill={danger ? 'var(--bg)' : 'var(--fg)'}>
          {text}
        </text>
      </g>
    </g>
  )
}
