import { useEffect, useRef, useState, type ReactNode } from 'react'
import { depth, points } from '../core/iso/geometry'
import { Crowd, FloorPath, FloorSpot, IsoBox, Tag } from '../core/iso/primitives'
import type { V3 } from '../core/types'
import { useMedia } from '../core/useMedia'

// A small looping picture for the top of the list page: one server takes more
// and more traffic until its queue fills and requests bounce off in red. Then
// a load balancer and two more servers rise in, the queues drain, and the
// loop starts over. Decorative only.

const LB: V3 = [-1.6, 0, 0]
const SERVER_X = 2.2
const SERVERS_Z = [-1.6, 0, 1.6]
const ALONE = 1 // the server that starts out alone, in the middle
const CUBE = 0.22
const FLY_Y = 0.45
const QUEUE_LIMIT = 4
const SLOT_GAP = 0.32
const FLIGHT_SECONDS = 1.3
const SERVE_RATE = 2.2 // requests per second, per server
const DROP_SECONDS = 0.8

// The loop, in seconds.
const LOOP = 15
const SCALE_AT = 7 // the new pieces start rising
const RISE = 0.9
const QUIET_AT = 13.2 // traffic stops so the scene empties
const SINK_AT = 13.8 // the new pieces sink away

const rate = (t: number) => (t < SCALE_AT ? 2 + (3 * t) / SCALE_AT : t < QUIET_AT ? 5 : 0)
const ease = (p: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, p)), 3)
const grown = (t: number) => (t < SINK_AT ? ease((t - SCALE_AT) / RISE) : 1 - ease((t - SINK_AT) / RISE))
const balanced = (t: number) => t >= SCALE_AT + RISE && t < SINK_AT

const slotX = (q: number) => SERVER_X - 0.85 - q * SLOT_GAP

interface Flight {
  server: number
  route: V3[]
  age: number
}
interface Queued {
  x: number
}
interface Drop {
  server: number
  age: number
}
interface Server {
  queue: Queued[]
  progress: number
  droppedAt: number
}
interface Sim {
  t: number
  owed: number
  turn: number
  flights: Flight[]
  drops: Drop[]
  servers: Server[]
}

function freshSim(): Sim {
  return {
    t: 0,
    owed: 0.6,
    turn: 0,
    flights: [],
    drops: [],
    servers: SERVERS_Z.map(() => ({ queue: [], progress: 0, droppedAt: -Infinity })),
  }
}

function step(sim: Sim, dt: number) {
  sim.t += dt
  if (sim.t >= LOOP) {
    Object.assign(sim, freshSim())
    return
  }

  sim.owed += rate(sim.t) * dt
  while (sim.owed >= 1) {
    sim.owed -= 1
    const server = balanced(sim.t) ? sim.turn++ % SERVERS_Z.length : ALONE
    const z = SERVERS_Z[server]
    const via: V3[] = balanced(sim.t) ? [[LB[0] - 0.6, FLY_Y, 0], [LB[0] + 0.6, FLY_Y, 0]] : []
    sim.flights.push({
      server,
      route: [[-4, FLY_Y, 0], ...via, [slotX(QUEUE_LIMIT) - 0.3, FLY_Y, z], [slotX(QUEUE_LIMIT), 0, z]],
      age: 0,
    })
  }

  for (const f of sim.flights) f.age += dt
  for (const f of sim.flights.filter((f) => f.age >= FLIGHT_SECONDS)) {
    const s = sim.servers[f.server]
    if (s.queue.length < QUEUE_LIMIT) s.queue.push({ x: slotX(QUEUE_LIMIT) })
    else {
      sim.drops.push({ server: f.server, age: 0 })
      s.droppedAt = sim.t
    }
  }
  sim.flights = sim.flights.filter((f) => f.age < FLIGHT_SECONDS)

  for (const d of sim.drops) d.age += dt
  sim.drops = sim.drops.filter((d) => d.age < DROP_SECONDS)

  for (const s of sim.servers) {
    s.queue.forEach((job, q) => (job.x += (slotX(q) - job.x) * Math.min(1, dt * 8)))
    if (s.queue.length === 0) continue
    s.progress += SERVE_RATE * dt
    if (s.progress >= 1) {
      s.progress = 0
      s.queue.shift()
    }
  }
}

// Where a request is after `age` seconds along its route, at constant speed.
function along(route: V3[], age: number): V3 {
  const legs = route.slice(1).map((p, i) => Math.hypot(p[0] - route[i][0], p[1] - route[i][1], p[2] - route[i][2]))
  let left = (age / FLIGHT_SECONDS) * legs.reduce((a, b) => a + b, 0)
  for (let i = 0; i < legs.length; i++) {
    if (left <= legs[i]) {
      const k = left / legs[i]
      const [a, b] = [route[i], route[i + 1]]
      return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k]
    }
    left -= legs[i]
  }
  return route[route.length - 1]
}

// With reduced motion, a still frame of the single server overflowing.
function stillSim(): Sim {
  const sim = freshSim()
  for (let i = 0; i < 6.6 * 60; i++) step(sim, 1 / 60)
  return sim
}

export default function HeroScene() {
  const still = useMedia('(prefers-reduced-motion: reduce)')
  const simRef = useRef<Sim>(null)
  if (!simRef.current) simRef.current = still ? stillSim() : freshSim()
  const [, setFrame] = useState(0)

  useEffect(() => {
    if (still) {
      simRef.current = stillSim()
      setFrame((f) => f + 1)
      return
    }
    let last = performance.now()
    let id = requestAnimationFrame(function tick(now) {
      step(simRef.current!, Math.min(0.05, (now - last) / 1000))
      last = now
      setFrame((f) => f + 1)
      id = requestAnimationFrame(tick)
    })
    return () => cancelAnimationFrame(id)
  }, [still])

  const sim = simRef.current
  const p = grown(sim.t)
  const solids: { d: number; node: ReactNode }[] = []
  const shown = (i: number) => (i === ALONE ? 1 : p)

  SERVERS_Z.forEach((z, i) => {
    const s = sim.servers[i]
    const hot = s.queue.length >= QUEUE_LIMIT || sim.t - s.droppedAt < 1
    if (shown(i) > 0) solids.push({ d: depth(SERVER_X, z), node: <ServerBox key={`s${i}`} z={z} grow={shown(i)} hot={hot} /> })
    s.queue.forEach((job, q) =>
      solids.push({ d: depth(job.x, z), node: <Cube key={`q${i}-${q}`} at={[job.x, CUBE / 2, z]} /> }),
    )
  })
  if (p > 0) solids.push({ d: depth(LB[0], LB[2]), node: <IsoBox key="lb" x={LB[0]} z={LB[2]} w={1.2} d={1.2} h={0.45 * p} fill="var(--fg)" opacity={p} /> })
  solids.push({ d: depth(-5, 0), node: <Crowd key="crowd" x={-5} active={Math.round(rate(sim.t) * 2)} /> })
  sim.flights.forEach((f, n) => {
    const at = along(f.route, f.age)
    solids.push({ d: depth(at[0], at[2]), node: <Cube key={`f${n}`} at={at} /> })
  })
  sim.drops.forEach((drop, n) => {
    // A bounced request slides off the line and fades.
    const k = drop.age / DROP_SECONDS
    const at: V3 = [slotX(QUEUE_LIMIT) - 0.2 * k, CUBE / 2, SERVERS_Z[drop.server] + 0.9 * k]
    solids.push({ d: depth(at[0], at[2]), node: <Cube key={`d${n}`} at={at} danger opacity={1 - k} /> })
  })
  solids.sort((a, b) => a.d - b.d)

  // Once the lone server drops a request, it stays labelled until help arrives.
  const overloaded = sim.t < SCALE_AT + RISE && sim.servers[ALONE].droppedAt > 0

  return (
    <svg viewBox="-245 -180 430 325"className="h-auto w-full" aria-hidden="true">
      <FloorPath route={[[-4, 0, 0], [slotX(QUEUE_LIMIT), 0, 0]]} />
      {SERVERS_Z.map((z, i) =>
        Array.from({ length: QUEUE_LIMIT }, (_, q) => (
          <g key={`${z}-${q}`} opacity={shown(i)}>
            <FloorSpot x={slotX(q)} z={z} size={CUBE + 0.08} />
          </g>
        )),
      )}
      {p > 0 && (
        <g opacity={p}>
          {SERVERS_Z.filter((_, i) => i !== ALONE).map((z) => (
            <FloorPath key={z} route={[[LB[0] + 0.6, 0, 0], [slotX(QUEUE_LIMIT), 0, z]]} />
          ))}
        </g>
      )}

      {solids.map((s) => s.node)}

      {overloaded && <Tag at={[SERVER_X, 2.1, 0]} label="Overloaded" danger />}
      {balanced(sim.t) && sim.t < QUIET_AT && sim.t - sim.servers[ALONE].droppedAt > 1 && <Tag at={[LB[0], 1.1, 0]} label="Scaled out" />}
    </svg>
  )
}

// A request cube, centred on `at`.
function Cube({ at, danger, opacity }: { at: V3; danger?: boolean; opacity?: number }) {
  return (
    <IsoBox
      x={at[0]}
      z={at[2]}
      y={at[1] - CUBE / 2}
      w={CUBE}
      d={CUBE}
      h={CUBE}
      fill={danger ? 'var(--danger)' : 'var(--fg)'}
      opacity={opacity}
    />
  )
}

function ServerBox({ z, grow, hot }: { z: number; grow: number; hot: boolean }) {
  const w = 1.1
  const h = 1.5 * grow
  const x0 = SERVER_X - w / 2
  const stroke = hot ? 'var(--danger)' : 'var(--fg)'
  return (
    <g opacity={grow}>
      <IsoBox x={SERVER_X} z={z} w={w} d={w} h={h} stroke={stroke} />
      {[0.35, 0.65, 0.95, 1.25]
        .filter((y) => y < h - 0.1)
        .map((y) => (
          <polyline
            key={y}
            points={points([
              [x0, y, z - w * 0.3],
              [x0, y, z + w * 0.3],
            ])}
            stroke={hot ? 'var(--danger)' : 'var(--line)'}
            strokeWidth={2.5}
            strokeLinecap="round"
          />
        ))}
    </g>
  )
}
