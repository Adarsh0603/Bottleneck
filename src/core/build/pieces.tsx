import { Cache } from '../flow/cache'
import { logOf, type Log } from '../flow/log'
import type { FlowNode } from '../flow/engine'
import { Worker } from '../flow/nodes'
import type { Provider } from '../flow/provider'
import { depth, points, project, S } from '../iso/geometry'
import { Crowd, IsoBox, IsoCylinder } from '../iso/primitives'
import type { PieceKind } from './types'

// Isometric drawings of every piece the builder can place, matching the
// look of the lesson scenes.

// How a breaker is set: passing requests, turning them back, or testing the road.
export type BreakerState = 'closed' | 'open' | 'half'

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
    case 'replica':
      return <IsoCylinder x={x} z={z} r={0.65} h={1.2 * rise} bands={[0.5]} />
    case 'autoscaler':
      return <Autoscaler x={x} z={z} rise={rise} />
    case 'ring':
      return <HashRing x={x} z={z} rise={rise} />
    case 'queue':
      return <QueuePiece x={x} z={z} rise={rise} fifo={waitingOf(node)} />
    case 'topic':
      return <TopicPiece x={x} z={z} rise={rise} />
    case 'stream':
      return <StreamPiece x={x} z={z} rise={rise} log={logOf(node)} />
    case 'limiter':
      return <LimiterPiece x={x} z={z} rise={rise} />
    case 'breaker':
      return <BreakerPiece x={x} z={z} rise={rise} state={(node as { state?: BreakerState } | undefined)?.state} />
    case 'provider':
      return <ProviderPiece x={x} z={z} rise={rise} down={(node as Provider | undefined)?.down} />
    case 'dead':
      return <DeadPiece x={x} z={z} rise={rise} fifo={waitingOf(node)} />
    case 'dedupe':
      return <DedupePiece x={x} z={z} rise={rise} />
  }
}

// What is waiting at a node that holds a line of jobs, like a queue.
const waitingOf = (node?: FlowNode) => {
  const n = node as { jobs?: unknown[]; capacity?: number } | undefined
  return n && Array.isArray(n.jobs) && typeof n.capacity === 'number' ? { jobs: n.jobs, capacity: n.capacity } : undefined
}

// A long low trough with a cell for each job it can hold, filled from the
// worker end as jobs wait.
function QueuePiece({ x, z, rise, fifo }: { x: number; z: number; rise: number; fifo?: { jobs: unknown[]; capacity: number } }) {
  const h = 0.4 * rise
  const cells = 10
  const used = fifo ? Math.ceil((fifo.jobs.length / fifo.capacity) * cells) : 0
  return (
    <g>
      <IsoBox x={x} z={z} w={1.6} d={1.1} h={h} />
      {rise === 1 &&
        Array.from({ length: cells }, (_, i) => {
          const cx = x + 0.7 - i * 0.15
          return (
            <polygon
              key={i}
              points={points([
                [cx - 0.05, h, z - 0.4],
                [cx - 0.05, h, z + 0.4],
                [cx + 0.05, h, z + 0.4],
                [cx + 0.05, h, z - 0.4],
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

// A low box with a broadcast mark on its lid: one event in, a copy out to
// everyone listening.
function TopicPiece({ x, z, rise }: { x: number; z: number; rise: number }) {
  const h = 0.7 * rise
  const [cx, cy] = project([x, h, z])
  return (
    <g>
      <IsoBox x={x} z={z} w={1.3} d={1.3} h={h} />
      {rise === 1 && (
        <g transform={`translate(${cx} ${cy})`} stroke="var(--fg)" strokeWidth={2.5} strokeLinecap="round" fill="none">
          <circle cx={-9} cy={0} r={2.6} fill="var(--fg)" stroke="none" />
          <path d="M-2 -6 A 8 8 0 0 1 -2 6 M5 -11 A 14 14 0 0 1 5 11 M12 -16 A 20 20 0 0 1 12 16" />
        </g>
      )}
    </g>
  )
}

// A wide box whose lid is a few lanes (partitions) of cells. Events are
// added on the left and stay put, so the cells fill with what has been kept.
function StreamPiece({ x, z, rise, log }: { x: number; z: number; rise: number; log?: Log }) {
  const h = 0.5 * rise
  const lanes = log?.partitions ?? 3
  const cells = 8
  const laneW = 1.5 / lanes
  return (
    <g>
      <IsoBox x={x} z={z} w={1.9} d={1.9} h={h} />
      {rise === 1 &&
        Array.from({ length: lanes }, (_, p) => {
          const kept = log ? log.lanes[p].length : [5, 3, 6][p % 3]
          const filled = Math.min(cells, Math.ceil(kept / 2))
          const cz = z - 0.75 + laneW * (p + 0.5)
          return Array.from({ length: cells }, (_, i) => {
            const cx = x - 0.75 + i * 0.19
            return (
              <polygon
                key={`${p}-${i}`}
                points={points([
                  [cx - 0.07, h, cz - laneW * 0.38],
                  [cx - 0.07, h, cz + laneW * 0.38],
                  [cx + 0.07, h, cz + laneW * 0.38],
                  [cx + 0.07, h, cz - laneW * 0.38],
                ])}
                fill={i < filled ? 'var(--fg)' : 'var(--subtle)'}
                stroke="var(--line)"
                strokeWidth={0.6}
              />
            )
          })
        })}
    </g>
  )
}

// A dark box with a funnel on its lid: many requests in, a trickle out.
function LimiterPiece({ x, z, rise }: { x: number; z: number; rise: number }) {
  const h = 0.8 * rise
  const [cx, cy] = project([x, h, z])
  return (
    <g>
      <IsoBox x={x} z={z} w={1.3} d={1.3} h={h} fill="var(--fg)" />
      {rise === 1 && (
        <path
          d="M-12 -9 H12 L3 1 V10 H-3 V1 Z"
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

// A dark box with a switch on its lid. Closed, the switch joins its two
// terminals and requests pass. Open, it lifts away and they are turned back.
// Half open, it hovers, letting one request through to test the road.
export function BreakerPiece({ x, z, rise = 1, state = 'closed' }: { x: number; z: number; rise?: number; state?: BreakerState }) {
  const h = 0.7 * rise
  const [cx, cy] = project([x, h, z])
  const lever = state === 'closed' ? 'M-11 0 H11' : state === 'half' ? 'M-11 0 L9 -6' : 'M-11 0 L8 -13'
  return (
    <g>
      <IsoBox x={x} z={z} w={1.3} d={1.3} h={h} fill="var(--fg)" stroke={state === 'open' ? 'var(--danger)' : undefined} />
      {rise === 1 && (
        <g transform={`translate(${cx} ${cy})`} stroke={state === 'open' ? 'var(--danger)' : 'var(--bg)'} strokeWidth={2.5} strokeLinecap="round" fill="none">
          <circle cx={-12} cy={0} r={2.2} fill="var(--bg)" stroke="none" />
          <circle cx={12} cy={0} r={2.2} fill="var(--bg)" stroke="none" />
          <path d={lever} strokeDasharray={state === 'half' ? '3 3' : undefined} />
        </g>
      )}
    </g>
  )
}

// A box with a cloud on its lid: a service somebody else runs. Red in an outage.
function ProviderPiece({ x, z, rise, down }: { x: number; z: number; rise: number; down?: boolean }) {
  const h = 0.9 * rise
  const [cx, cy] = project([x, h, z])
  return (
    <g>
      <IsoBox x={x} z={z} w={1.7} d={1.7} h={h} stroke={down ? 'var(--danger)' : undefined} />
      {rise === 1 && (
        <path
          d="M-14 6 H12 A7 7 0 0 0 12 -8 A9 9 0 0 0 -4 -10 A8 8 0 0 0 -14 6 Z"
          transform={`translate(${cx} ${cy})`}
          stroke={down ? 'var(--danger)' : 'var(--fg)'}
          strokeWidth={2.5}
          strokeLinejoin="round"
          fill="none"
        />
      )}
    </g>
  )
}

// A low dark trough like a queue, but its cells fill in red: the messages
// that gave up.
function DeadPiece({ x, z, rise, fifo }: { x: number; z: number; rise: number; fifo?: { jobs: unknown[]; capacity: number } }) {
  const h = 0.4 * rise
  const cells = 8
  const used = fifo ? Math.ceil((fifo.jobs.length / fifo.capacity) * cells) : 0
  return (
    <g>
      <IsoBox x={x} z={z} w={1.6} d={1.1} h={h} fill="var(--fg)" />
      {rise === 1 &&
        Array.from({ length: cells }, (_, i) => {
          const cx = x - 0.6 + i * 0.17
          return (
            <polygon
              key={i}
              points={points([
                [cx - 0.05, h, z - 0.4],
                [cx - 0.05, h, z + 0.4],
                [cx + 0.05, h, z + 0.4],
                [cx + 0.05, h, z - 0.4],
              ])}
              fill={i < used ? 'var(--danger)' : 'var(--bg)'}
              stroke="var(--line)"
              strokeWidth={0.6}
            />
          )
        })}
    </g>
  )
}

// A low box with a tick on its lid: it remembers what has been sent.
function DedupePiece({ x, z, rise }: { x: number; z: number; rise: number }) {
  const h = 0.6 * rise
  const [cx, cy] = project([x, h, z])
  return (
    <g>
      <IsoBox x={x} z={z} w={1.3} d={1.3} h={h} fill="var(--fg)" />
      {rise === 1 && <path d="M-10 0 L-3 7 L11 -8" transform={`translate(${cx} ${cy})`} stroke="var(--bg)" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" fill="none" />}
    </g>
  )
}

// A low dark disc with a ring on its lid: it places servers on a circle.
function HashRing({ x, z, rise }: { x: number; z: number; rise: number }) {
  const h = 0.4 * rise
  const rx = Math.SQRT2 * 0.4 * Math.cos(Math.PI / 6) * S
  const ry = (Math.SQRT2 * 0.4 * S) / 2
  const [cx, cy] = project([x, h, z])
  return (
    <g>
      <IsoCylinder x={x} z={z} r={0.65} h={h} bands={[]} />
      {rise === 1 && <ellipse cx={cx} cy={cy} rx={rx} ry={ry} fill="none" stroke="var(--fg)" strokeWidth={2.5} strokeDasharray="3 4" strokeLinecap="round" />}
    </g>
  )
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
  if (worker && !worker.alive) return <IsoBox x={x} z={z} w={w} d={w} h={h} dim stroke="var(--danger)" />
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
  const box = kind === 'users' ? '-70 -60 140 110' : kind === 'database' || kind === 'replica' || kind === 'cache' || kind === 'ring' || kind === 'queue' || kind === 'topic' || kind === 'stream' || kind === 'limiter' || kind === 'breaker' || kind === 'provider' || kind === 'dead' || kind === 'dedupe' ? '-55 -80 110 110' : '-45 -80 90 100'
  return (
    <svg viewBox={box} width={size} height={size} aria-hidden className="shrink-0">
      <Piece kind={kind} x={0} z={0} active={6} />
    </svg>
  )
}
