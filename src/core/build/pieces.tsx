import { Cache } from '../flow/cache'
import type { FlowNode } from '../flow/engine'
import { Worker } from '../flow/nodes'
import { depth, points, project } from '../iso/geometry'
import { Crowd, IsoBox, IsoCylinder } from '../iso/primitives'
import type { PieceKind } from './types'

// Isometric drawings of every piece the builder can place, matching the
// look of the lesson scenes.

export function Piece({
  kind,
  x,
  z,
  node,
  rise = 1,
  active = 0,
}: {
  kind: PieceKind
  x: number
  z: number
  node?: FlowNode
  rise?: number
  active?: number // users: how many light up
}) {
  const worker = node instanceof Worker ? node : undefined
  switch (kind) {
    case 'users':
      return <Crowd x={x} z={z} active={active} />
    case 'balancer':
      return <Balancer x={x} z={z} rise={rise} />
    case 'server':
      return <Server x={x} z={z} rise={rise} worker={worker} w={1.1} h={1.5} />
    case 'app':
      return <Server x={x} z={z} rise={rise} worker={worker} w={1.5} h={1.4} />
    case 'cache':
      return <CachePiece x={x} z={z} rise={rise} cache={node instanceof Cache ? node : undefined} />
    case 'database':
      return <IsoCylinder x={x} z={z} r={0.85} h={1.7 * rise} />
    case 'autoscaler':
      return <Autoscaler x={x} z={z} rise={rise} />
  }
}

// A low dark box with up and down arrows on its lid: it adds and removes
// servers.
function Autoscaler({ x, z, rise }: { x: number; z: number; rise: number }) {
  const h = 0.5 * rise
  const [cx, cy] = project([x, h, z])
  return (
    <g>
      <IsoBox x={x} z={z} w={1.1} d={1.1} h={h} fill="var(--fg)" />
      {rise === 1 && (
        <path
          d="M-7 6 V-8 M-12 -3 L-7 -8 L-2 -3 M7 -8 V6 M2 1 L7 6 L12 1"
          transform={`translate(${cx} ${cy})`}
          stroke="var(--bg)"
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
      )}
    </g>
  )
}

function Balancer({ x, z, rise }: { x: number; z: number; rise: number }) {
  const h = 0.45 * rise
  const [cx, cy] = project([x, h, z])
  return (
    <g>
      <IsoBox x={x} z={z} w={1.3} d={1.3} h={h} fill="var(--fg)" />
      {rise === 1 && (
        <path
          d="M-14 6 L0 0 M0 0 L14 -10 M0 0 L16 0 M0 0 L10 10"
          transform={`translate(${cx} ${cy})`}
          stroke="var(--bg)"
          strokeWidth={2.5}
          strokeLinecap="round"
          fill="none"
        />
      )}
    </g>
  )
}

function Server({ x, z, rise, worker, w, h: fullH }: { x: number; z: number; rise: number; worker?: Worker; w: number; h: number }) {
  const h = fullH * rise
  const overloaded = !!worker && worker.queue.length >= worker.queueLimit * 0.75
  const x0 = x - w / 2
  const slot = 0.3
  const slots = [
    [-0.25, -0.25],
    [0.25, -0.25],
    [-0.25, 0.25],
    [0.25, 0.25],
  ].sort((a, b) => depth(a[0], a[1]) - depth(b[0], b[1]))
  return (
    <g>
      <IsoBox x={x} z={z} w={w} d={w} h={h} stroke={overloaded ? 'var(--danger)' : 'var(--fg)'} />
      {rise === 1 &&
        [0.22, 0.42, 0.62, 0.82].map((f) => (
          <polyline
            key={f}
            points={points([
              [x0, fullH * f, z - w * 0.3],
              [x0, fullH * f, z + w * 0.3],
            ])}
            stroke="var(--line)"
            strokeWidth={2.5}
            strokeLinecap="round"
          />
        ))}
      {rise === 1 &&
        slots.map(([dx, dz], i) => (
          <IsoBox
            key={i}
            x={x + dx}
            z={z + dz}
            y={h}
            w={slot}
            d={slot}
            h={slot}
            fill={worker && i < worker.active.length ? 'var(--fg)' : undefined}
          />
        ))}
    </g>
  )
}

// A flat box with memory cells on its lid: one per item it can hold, filled
// when used.
function CachePiece({ x, z, rise, cache }: { x: number; z: number; rise: number; cache?: Cache }) {
  const h = 0.55 * rise
  const capacity = cache?.capacity ?? 8
  const used = cache?.entries.size ?? 0
  return (
    <g>
      <IsoBox x={x} z={z} w={1.9} d={1.9} h={h} />
      {rise === 1 &&
        Array.from({ length: Math.min(capacity, 40) }, (_, i) => {
          const cx = x - 0.7 + (i % 8) * 0.2
          const cz = z - 0.6 + Math.floor(i / 8) * 0.3
          return (
            <polygon
              key={i}
              points={points([
                [cx - 0.08, h, cz - 0.12],
                [cx - 0.08, h, cz + 0.12],
                [cx + 0.08, h, cz + 0.12],
                [cx + 0.08, h, cz - 0.12],
              ])}
              fill={i < used ? 'var(--fg)' : 'var(--subtle)'}
              stroke="var(--line)"
              strokeWidth={0.6}
            />
          )
        })}
    </g>
  )
}

// A small picture of a piece, for the toolbox and the piece being dragged.
export function PieceIcon({ kind, size = 40 }: { kind: PieceKind; size?: number }) {
  const box = kind === 'users' ? '-70 -60 140 110' : kind === 'database' || kind === 'cache' ? '-55 -80 110 110' : '-45 -80 90 100'
  return (
    <svg viewBox={box} width={size} height={size} aria-hidden className="shrink-0">
      <Piece kind={kind} x={0} z={0} active={6} />
    </svg>
  )
}
