import { useEffect, useRef, useState, type RefObject } from 'react'
import { BOX, CUBE, FLY_Y, PATH_START, queueSpot, SERVER_FRONT, SERVER_X, USERS_X } from '../prototype3d/layout'
import type { ServerTag } from '../prototype3d/Server3D'
import type { LoadBalancerSim, Server } from '../simulators/loadBalancer/engine'
import { MS_PER_TICK, TICKS_PER_SECOND } from '../simulators/loadBalancer/useSim'

// Isometric projection of the same world the 3D prototype uses.
// x runs users → server (bottom-left → top-right on screen), y is up, and a
// larger (z − x) is closer to the viewer, so we paint in that order.
const S = 46
const COS = Math.cos(Math.PI / 6)

type V3 = [number, number, number]

function project([x, y, z]: V3): [number, number] {
  return [(x + z) * COS * S, ((z - x) * 0.5 - y) * S]
}

const points = (vs: V3[]) => vs.map((v) => project(v).join(',')).join(' ')
const depth = (x: number, z: number) => z - x

const FALL_SECONDS = 1.4
const RISE_MS = 900
const SLOT = 0.36

export default function IsoScene({
  simRef,
  lastTickAt,
  rps,
  tags,
  usersTag,
}: {
  simRef: RefObject<LoadBalancerSim | null>
  lastTickAt: RefObject<number>
  rps: number
  tags: ServerTag[]
  usersTag: boolean
}) {
  // Redraw every animation frame so requests glide between the 20 Hz ticks.
  const [now, setNow] = useState(() => performance.now())
  const mountedAt = useRef(now)
  useEffect(() => {
    let id = requestAnimationFrame(function loop(t) {
      setNow(t)
      id = requestAnimationFrame(loop)
    })
    return () => cancelAnimationFrame(id)
  }, [])

  const sim = simRef.current
  if (!sim) return null
  const server = sim.servers[0]
  const queueLimit = sim.config.queueLimit
  const frac = Math.min(1, Math.max(0, (now - lastTickAt.current) / MS_PER_TICK))
  const rise = easeOut(Math.min(1, (now - mountedAt.current) / RISE_MS))
  const overloaded = !!server && server.queue.length >= queueLimit * 0.75

  return (
    <svg viewBox="-370 -270 680 540" className="h-full w-full select-none" role="img" aria-label="Isometric request flow">
      <IsoGrid />

      {/* Path from users to the server, painted on the floor. */}
      <polyline
        points={points([
          [PATH_START, 0, 0],
          [SERVER_FRONT, 0, 0],
        ])}
        stroke="var(--muted)"
        strokeWidth={1}
        strokeDasharray="5 5"
        fill="none"
      />

      {/* Queue spots on the floor. */}
      {Array.from({ length: queueLimit }, (_, i) => {
        const [x, , z] = queueSpot(i)
        const r = (CUBE + 0.08) / 2
        return (
          <polygon
            key={i}
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
      })}

      {server && <ServerBox server={server} rise={rise} overloaded={overloaded} />}

      {server?.queue.map((job, i) => {
        const [x, , z] = queueSpot(i)
        return <IsoBox key={job.id} x={x} z={z} w={CUBE} d={CUBE} h={CUBE} fill={overloaded ? 'var(--danger)' : 'var(--fg)'} />
      })}

      <Users rps={rps} />

      {/* Requests in flight, hopping toward the server. */}
      {sim.inTransit.map((t) => {
        const p = Math.min(1, t.progress + frac / sim.config.transitTicks)
        const x = PATH_START + (SERVER_FRONT - 0.2 - PATH_START) * p
        const z = (((t.job.id * 37) % 7) - 3) * 0.07
        const y = FLY_Y - CUBE / 2 + Math.sin(p * Math.PI) * 0.35
        return <IsoBox key={t.job.id} x={x} z={z} y={y} w={CUBE} d={CUBE} h={CUBE} fill="var(--fg)" />
      })}

      {/* Dropped requests tumble off the end of the line and fade away. */}
      {sim.recentDrops.map((d) => {
        const age = (sim.tick - d.tick + frac) / TICKS_PER_SECOND
        if (age > FALL_SECONDS) return null
        const [endX] = queueSpot(queueLimit)
        const side = d.jobId % 2 === 0 ? 1 : -1
        const x = (d.serverId === undefined ? PATH_START : endX) - age * 0.6
        return (
          <IsoBox
            key={`drop-${d.jobId}`}
            x={x}
            z={side * (0.15 + age * 0.9)}
            y={FLY_Y + age * 1.2 - 5 * age * age}
            w={CUBE}
            d={CUBE}
            h={CUBE}
            fill="var(--danger)"
            opacity={1 - age / FALL_SECONDS}
          />
        )
      })}

      {/* Labels on top of everything. */}
      {usersTag && <Tag at={[USERS_X, 1.0, 0]} label="Users" />}
      {tags.includes('server') && <Tag at={[SERVER_X, BOX.h + 0.7, 0]} label="Server" />}
      {tags.includes('workers') && server && <Tag at={[SERVER_X, BOX.h + 0.7, 0]} label={`${server.slots} workers`} />}
      {tags.includes('queue') && server && (
        <Tag
          at={[queueSpot((queueLimit - 1) / 2)[0], 0.75, 0]}
          label={`Queue · ${server.queue.length}/${queueLimit}`}
          danger={overloaded}
        />
      )}
      {tags.includes('dropped') && overloaded && <Tag at={[queueSpot(queueLimit)[0] - 0.4, 1.3, 0]} label="Dropped" danger />}
    </svg>
  )
}

function easeOut(t: number) {
  return 1 - Math.pow(1 - t, 3)
}

// A box standing on the floor. Without `fill` it uses the neutral server
// shades; with `fill` the side faces get darkened for depth.
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
  dashed,
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
  dashed?: boolean
}) {
  const x0 = x - w / 2
  const x1 = x + w / 2
  const z0 = z - d / 2
  const z1 = z + d / 2
  const y1 = y + h
  const left: V3[] = [[x0, y, z0], [x0, y, z1], [x0, y1, z1], [x0, y1, z0]]
  const right: V3[] = [[x0, y, z1], [x1, y, z1], [x1, y1, z1], [x0, y1, z1]]
  const top: V3[] = [[x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0]]
  const line = { stroke: fill ? 'none' : stroke, strokeWidth: 1.2, strokeLinejoin: 'round' as const, strokeDasharray: dashed ? '4 4' : undefined }

  return (
    <g opacity={opacity}>
      <polygon points={points(left)} fill={fill ?? 'var(--iso-left)'} {...line} />
      {fill && <polygon points={points(left)} fill="#000" opacity={0.18} />}
      <polygon points={points(right)} fill={fill ?? 'var(--iso-right)'} {...line} />
      {fill && <polygon points={points(right)} fill="#000" opacity={0.36} />}
      <polygon points={points(top)} fill={fill ?? 'var(--iso-top)'} {...line} />
    </g>
  )
}

function ServerBox({ server, rise, overloaded }: { server: Server; rise: number; overloaded: boolean }) {
  const h = BOX.h * rise
  const stroke = overloaded ? 'var(--danger)' : 'var(--fg)'
  const x0 = SERVER_X - BOX.w / 2

  const slots = Array.from({ length: server.slots }, (_, k) => ({
    k,
    x: SERVER_X + ((k % 2) - 0.5) * 0.6,
    z: (Math.floor(k / 2) - 0.5) * 0.6,
  })).sort((a, b) => depth(a.x, a.z) - depth(b.x, b.z))

  return (
    <g>
      <IsoBox x={SERVER_X} z={0} w={BOX.w} d={BOX.d} h={h} stroke={stroke} />
      {/* Rack vents on the visible side, so it reads as a server. */}
      {rise === 1 &&
        [0.45, 0.8, 1.15, 1.5].map((y) => (
          <polyline
            key={y}
            points={points([
              [x0, y, -BOX.d * 0.32],
              [x0, y, BOX.d * 0.32],
            ])}
            stroke="var(--line)"
            strokeWidth={3}
            strokeLinecap="round"
          />
        ))}
      {rise === 1 &&
        slots.map((s) => (
          <IsoBox
            key={s.k}
            x={s.x}
            z={s.z}
            y={h}
            w={SLOT}
            d={SLOT}
            h={SLOT}
            fill={s.k < server.active.length ? 'var(--fg)' : undefined}
            stroke="var(--fg)"
          />
        ))}
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
  const lines = []
  for (let v = -12; v <= 10; v += 0.5) {
    const major = v % 2.5 === 0
    const stroke = major ? 'var(--muted)' : 'var(--line)'
    const width = major ? 0.8 : 0.6
    lines.push(
      <polyline key={`x${v}`} points={points([[v, 0, -8], [v, 0, 8]])} stroke={stroke} strokeWidth={width} opacity={major ? 0.45 : 1} />,
    )
  }
  for (let v = -8; v <= 8; v += 0.5) {
    const major = v % 2.5 === 0
    const stroke = major ? 'var(--muted)' : 'var(--line)'
    const width = major ? 0.8 : 0.6
    lines.push(
      <polyline key={`z${v}`} points={points([[-12, 0, v], [10, 0, v]])} stroke={stroke} strokeWidth={width} opacity={major ? 0.45 : 1} />,
    )
  }
  return (
    <g>
      <defs>
        <radialGradient id="iso-grid-fade" cx="50%" cy="50%" r="50%">
          <stop offset="35%" stopColor="#fff" />
          <stop offset="100%" stopColor="#000" />
        </radialGradient>
        <mask id="iso-grid-mask" maskUnits="userSpaceOnUse" x={-700} y={-500} width={1300} height={900}>
          <rect x={-700} y={-500} width={1300} height={900} fill="url(#iso-grid-fade)" />
        </mask>
      </defs>
      <g mask="url(#iso-grid-mask)" fill="none">
        {lines}
      </g>
    </g>
  )
}

// A label pinned above a point in the world.
function Tag({ at, label, danger }: { at: V3; label: string; danger?: boolean }) {
  const [sx, sy] = project(at)
  const text = label.toUpperCase()
  const w = text.length * 7.4 + 24
  const color = danger ? 'var(--danger)' : 'var(--fg)'
  return (
    <g transform={`translate(${sx} ${sy})`}>
      <g className="tag-in">
        <line y1={0} y2={-14} stroke={color} />
        <rect x={-w / 2} y={-38} width={w} height={24} rx={12} fill={danger ? color : 'var(--bg)'} stroke={color} />
        <text
          y={-22}
          textAnchor="middle"
          className="font-mono"
          fontSize={11}
          letterSpacing={1}
          fill={danger ? 'var(--bg)' : 'var(--fg)'}
        >
          {text}
        </text>
      </g>
    </g>
  )
}
