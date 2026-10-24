import { useLayoutEffect, useRef, useState } from 'react'
import { Piece } from '../core/build/pieces'
import type { PieceKind } from '../core/build/types'
import { project } from '../core/iso/geometry'
import { FloorPath, IsoBox, IsoCylinder } from '../core/iso/primitives'
import type { V3 } from '../core/types'
import { useMedia } from '../core/useMedia'
import type { TopicEntry, TrackId } from '../topics/registry'

// A small still picture of each topic's idea for its card on the list page.
// While `live` (the card is hovered or focused), requests travel along the
// routes. Topics not built yet show a dashed outline instead.

const FLY_Y = 0.45
const CUBE = 0.24
const TRIP_SECONDS = 1.8

interface Thumb {
  pieces: { kind: PieceKind; x: number; z: number; active?: number; ghost?: boolean }[]
  routes: V3[][] // floor-level points; requests fly along them
}

// Floor spots given in screen directions: u runs right, v runs down.
const ground = (u: number, v: number) => ({ x: (u - v) / 2, z: (u + v) / 2 })
const screen = (u: number, v: number): V3 => [(u - v) / 2, 0, (u + v) / 2]

const THUMBS: Record<string, Thumb> = {
  'load-balancing': {
    pieces: [
      { kind: 'server', x: 1.6, z: -1.5 },
      { kind: 'server', x: 1.6, z: 0 },
      { kind: 'server', x: 1.6, z: 1.5 },
      { kind: 'balancer', x: -1, z: 0 },
      { kind: 'users', x: -3.6, z: 0, active: 8 },
    ],
    routes: [-1.5, 0, 1.5].map((z): V3[] => [[-2.6, 0, 0], [-1.7, 0, 0], [-0.3, 0, 0], [0.9, 0, z]]),
  },
  caching: {
    pieces: [
      { kind: 'database', x: 2.6, z: -1.6 },
      { kind: 'cache', x: 1.2, z: 1.3 },
      { kind: 'app', x: -1.4, z: 0 },
      { kind: 'users', x: -4.3, z: 0, active: 8 },
    ],
    routes: [
      [[-3.3, 0, 0], [-2.2, 0, 0], [-0.6, 0, 0.6], [0.2, 0, 1.1]],
      [[-3.3, 0, 0], [-2.2, 0, 0], [-0.6, 0, 0.6], [0.2, 0, 1.1]],
      [[-3.3, 0, 0], [-2.2, 0, 0], [-0.6, 0, -0.6], [1.8, 0, -1.6]],
    ],
  },
  // Two groups of users, each served by an edge box beside them; the origin
  // stands far off at the back.
  cdn: {
    pieces: [
      { kind: 'app', ...ground(4.8, -4.6) },
      { kind: 'server', ...ground(0.6, -1.4) },
      { kind: 'users', ...ground(-2.8, -1.4), active: 6 },
      { kind: 'server', ...ground(-0.6, 3.6) },
      { kind: 'users', ...ground(-4, 3.6), active: 6 },
    ],
    routes: [
      [screen(-1.6, -1.4), screen(-0.4, -1.4)],
      [screen(-2.8, 3.6), screen(-1.6, 3.6)],
      [screen(1.6, -2.2), screen(3.6, -3.8)],
    ],
  },
  autoscaling: {
    pieces: [
      { kind: 'server', x: 1.6, z: -1.5 },
      { kind: 'server', x: 1.6, z: 0 },
      { kind: 'server', x: 1.6, z: 1.5, ghost: true },
      { kind: 'autoscaler', x: -1, z: 0 },
      { kind: 'users', x: -3.6, z: 0, active: 10 },
    ],
    routes: [-1.5, 0].map((z): V3[] => [[-2.6, 0, 0], [-1.6, 0, 0], [-0.4, 0, 0], [0.9, 0, z]]),
  },
  // A primary in the middle of a column of replicas, all fed by the app.
  replication: {
    pieces: [
      { kind: 'database', x: 2, z: -1.9 },
      { kind: 'database', x: 2, z: 0 },
      { kind: 'database', x: 2, z: 1.9 },
      { kind: 'app', x: -1.4, z: 0 },
      { kind: 'users', x: -4.3, z: 0, active: 8 },
    ],
    routes: [-1.9, 0, 1.9].map((z): V3[] => [[-3.3, 0, 0], [-2.2, 0, 0], [-0.6, 0, 0], [1.1, 0, z]]),
  },
  // A row of shards, each fed its own share by the app.
  sharding: {
    pieces: [
      { kind: 'database', x: 2, z: -2.85 },
      { kind: 'database', x: 2, z: -0.95 },
      { kind: 'database', x: 2, z: 0.95 },
      { kind: 'database', x: 2, z: 2.85 },
      { kind: 'app', x: -1.4, z: 0 },
      { kind: 'users', x: -4.3, z: 0, active: 8 },
    ],
    routes: [-2.85, -0.95, 0.95, 2.85].map((z): V3[] => [[-3.3, 0, 0], [-2.2, 0, 0], [-0.6, 0, 0], [1.1, 0, z]]),
  },
  // Servers around a ring, with the database in the middle.
  'consistent-hashing': {
    pieces: [
      { kind: 'server', x: 1.2, z: -1.7 },
      { kind: 'server', x: 3.4, z: 0.2 },
      { kind: 'server', x: 1.2, z: 2.1 },
      { kind: 'database', x: 1.2, z: 0.2 },
      { kind: 'app', x: -1.8, z: 0.2 },
      { kind: 'users', x: -4.6, z: 0.2, active: 8 },
    ],
    routes: [-1.7, 2.1].map((z): V3[] => [[-3.6, 0, 0.2], [-2.5, 0, 0.2], [-0.8, 0, 0.2], [0.6, 0, z]]),
  },
  // Users and an app feed a queue, which feeds a row of workers.
  queues: {
    pieces: [
      { kind: 'server', x: 2.2, z: -1.5 },
      { kind: 'server', x: 2.2, z: 0 },
      { kind: 'server', x: 2.2, z: 1.5 },
      { kind: 'queue', x: -0.6, z: 0 },
      { kind: 'app', x: -2.6, z: 0 },
      { kind: 'users', x: -5, z: 0, active: 8 },
    ],
    routes: [-1.5, 0, 1.5].map((z): V3[] => [[-3.8, 0, 0], [-3.2, 0, 0], [-1.6, 0, 0], [0.4, 0, 0], [1.2, 0, z]]),
  },
  // An order service feeds a channel, which copies every event to three teams.
  pubsub: {
    pieces: [
      { kind: 'server', x: 2.2, z: -1.5 },
      { kind: 'server', x: 2.2, z: 0 },
      { kind: 'server', x: 2.2, z: 1.5 },
      { kind: 'topic', x: -0.6, z: 0 },
      { kind: 'app', x: -2.8, z: 0 },
    ],
    routes: [-1.5, 0, 1.5].map((z): V3[] => [[-1.8, 0, 0], [-1.2, 0, 0], [0.4, 0, 0], [1.2, 0, z]]),
  },
  // Three clients feed a limiter, which feeds the API.
  'rate-limiting': {
    pieces: [
      { kind: 'app', x: 2.6, z: 0 },
      { kind: 'limiter', x: -0.6, z: 0 },
      { kind: 'users', x: -3.6, z: -1.6, active: 3 },
      { kind: 'users', x: -3.6, z: 1.6, active: 8 },
    ],
    routes: [-1.6, 1.6].map((z): V3[] => [[-2.4, 0, z], [-1.8, 0, 0], [-1.4, 0, 0], [0.8, 0, 0]]),
  },
  // Users call a shop, which reaches two services through a breaker apiece.
  'circuit-breakers': {
    pieces: [
      { kind: 'app', x: 3.2, z: -1.7 },
      { kind: 'app', x: 3.2, z: 1.7 },
      { kind: 'breaker', x: 0.6, z: -0.9 },
      { kind: 'breaker', x: 0.6, z: 0.9 },
      { kind: 'app', x: -2, z: 0 },
      { kind: 'users', x: -4.8, z: 0, active: 8 },
    ],
    routes: [-1.7, 1.7].map((z): V3[] => [[-4, 0, 0], [-2.6, 0, 0], [-1.2, 0, 0], [0.2, 0, z * 0.5], [2.2, 0, z]]),
  },
  // Two regions, each with its users and a database, and a link between them.
  cap: {
    pieces: [
      { kind: 'database', x: 1.4, z: -1.7 },
      { kind: 'database', x: 1.4, z: 1.7 },
      { kind: 'users', x: -2.8, z: -1.7, active: 6 },
      { kind: 'users', x: -2.8, z: 1.7, active: 6 },
    ],
    routes: [-1.7, 1.7].map((z): V3[] => [[-1.8, 0, z], [0.2, 0, z]]),
  },
}

const SOON: Thumb = { pieces: [], routes: [] }

const fly = (route: V3[]): V3[] => route.map(([x, , z]) => [x, FLY_Y, z])
const screenPath = (route: V3[]) => {
  const [first, ...rest] = fly(route).map((p) => project(p))
  return `M ${first.join(' ')} ${rest.map((p) => `L ${p.join(' ')}`).join(' ')}`
}

// The point `t` of the way along a route.
function along(route: V3[], t: number): V3 {
  const pts = fly(route)
  const legs = pts.slice(1).map((p, i) => Math.hypot(p[0] - pts[i][0], p[2] - pts[i][2]))
  let left = t * legs.reduce((a, b) => a + b, 0)
  for (let i = 0; i < legs.length; i++) {
    if (left <= legs[i]) {
      const k = left / legs[i]
      const [a, b] = [pts[i], pts[i + 1]]
      return [a[0] + (b[0] - a[0]) * k, FLY_Y, a[2] + (b[2] - a[2]) * k]
    }
    left -= legs[i]
  }
  return pts[pts.length - 1]
}

export default function TopicThumb({ topic, live }: { topic: TopicEntry; live: boolean }) {
  const still = useMedia('(prefers-reduced-motion: reduce)')
  const thumb = topic.Play ? (THUMBS[topic.id] ?? SOON) : SOON

  // Frame the drawing tightly, so each picture fills its card the same way.
  const drawing = useRef<SVGGElement>(null)
  const [box, setBox] = useState('-200 -150 400 300')
  useLayoutEffect(() => {
    const b = drawing.current?.getBBox()
    const pad = 6
    if (b) setBox(`${b.x - pad} ${b.y - pad} ${b.width + pad * 2} ${b.height + pad * 2}`)
  }, [topic.id])

  if (thumb.pieces.length === 0) return <SoonThumb track={topic.track} />

  const animate = live && !still
  return (
    <svg viewBox={box} className="h-full w-full" aria-hidden="true">
      <g ref={drawing}>
      {thumb.routes.map((route, i) => (
        <FloorPath key={i} route={route} />
      ))}
      {thumb.pieces.map((p, i) =>
        p.ghost ? (
          <IsoBox key={i} x={p.x} z={p.z} w={1.1} d={1.1} h={1.5} ghost />
        ) : (
          <Piece key={i} kind={p.kind} x={p.x} z={p.z} active={p.active} />
        ),
      )}
      </g>
      {thumb.routes.map((route, i) =>
        animate ? (
          <g key={i} opacity={0}>
            <Cube />
            <animateMotion dur={`${TRIP_SECONDS}s`} begin={`${(i * TRIP_SECONDS) / thumb.routes.length}s`} repeatCount="indefinite" path={screenPath(route)} />
            <animate
              attributeName="opacity"
              values="0;1;1;0"
              keyTimes="0;0.1;0.85;1"
              dur={`${TRIP_SECONDS}s`}
              begin={`${(i * TRIP_SECONDS) / thumb.routes.length}s`}
              repeatCount="indefinite"
            />
          </g>
        ) : (
          <g key={i} transform={`translate(${project(along(route, 0.55)).join(' ')})`}>
            <Cube />
          </g>
        ),
      )}
    </svg>
  )
}

// A topic not built yet: a small dashed outline hinting at its track (a
// database for data, a queue for async, a cluster for distributed, a tower
// for the capstones).
function SoonThumb({ track }: { track: TrackId }) {
  return (
    <svg viewBox="-150 -110 300 150" className="h-full w-full" aria-hidden="true">
      {track === 'data' ? (
        <IsoCylinder x={0} z={0} r={0.7} h={1.4} dim />
      ) : track === 'async' ? (
        [-0.9, 0, 0.9].map((x) => <IsoBox key={x} x={x} z={0} w={0.6} d={0.6} h={0.6} ghost />)
      ) : track === 'distributed' ? (
        [[0.8, -0.8], [-0.8, -0.4], [0.4, 0.8]].map(([x, z]) => <IsoBox key={x} x={x} z={z} w={0.7} d={0.7} h={1} ghost />)
      ) : (
        <IsoBox x={0} z={0} w={1} d={1} h={2.2} ghost />
      )}
    </svg>
  )
}

// A request cube drawn around the origin, to be moved into place.
function Cube() {
  return <IsoBox x={0} z={0} y={-CUBE / 2} w={CUBE} d={CUBE} h={CUBE} fill="var(--fg)" />
}
