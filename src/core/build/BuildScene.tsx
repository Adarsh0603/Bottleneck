import { useRef, type PointerEvent, type ReactNode } from 'react'
import { Worker } from '../flow/nodes'
import { depth, points } from '../iso/geometry'
import { FloorPath, IsoBox } from '../iso/primitives'
import Viewport from '../iso/Viewport'
import type { V3 } from '../types'
import { Piece } from './pieces'
import { MS_PER_TICK, TICKS_PER_SECOND, type Running } from './run'
import { HALF, type BuildTask, type PieceKind, type Placement } from './types'

const PAD = 1.5
const CUBE = 0.24
const FLY_Y = 0.6
const QUEUE_GAP = 0.28
const FALL_SECONDS = 1.4
const RISE_MS = 700

// The floor the learner builds on: pads, the pieces placed so far, and live
// traffic moving through them.
export default function BuildScene({
  task,
  run,
  placed,
  lastTickAt,
  dragKind,
  hoverPad,
  onPadClick,
  onPieceDown,
}: {
  task: BuildTask
  run: Running
  placed: Placement
  lastTickAt: { current: number }
  dragKind: PieceKind | null
  hoverPad: string | null
  onPadClick: (padId: string) => void
  onPieceDown: (padId: string, e: PointerEvent) => void
}) {
  const born = useRef(new Map<string, number>())

  // Where every node stands, by key: fixed pieces and filled pads.
  const spots = new Map<string, { kind: PieceKind; x: number; z: number }>()
  for (const f of task.fixed) spots.set(f.id, f)
  for (const pad of task.pads) {
    const kind = placed[pad.id]
    if (kind) spots.set(pad.id, { kind, x: pad.x, z: pad.z })
  }

  return (
    <Viewport target={task.shot.target} zoom={task.shot.zoom} shake={0} panKey={task} label="Build area. Drag pieces onto the pads.">
      {({ now }) => {
        const flow = run.flow
        const frac = Math.min(1, Math.max(0, (now - lastTickAt.current) / MS_PER_TICK))
        const riseOf = (key: string) => {
          if (!born.current.has(key)) born.current.set(key, now)
          const t = Math.min(1, (now - born.current.get(key)!) / RISE_MS)
          return 1 - Math.pow(1 - t, 3)
        }
        for (const key of born.current.keys()) {
          const [padId, kind] = key.split(':')
          if (placed[padId] !== kind) born.current.delete(key)
        }

        const exit = (key: string): V3 => {
          const s = spots.get(key)!
          return [s.x + HALF[s.kind], FLY_Y, s.z]
        }
        const entry = (key: string): V3 => {
          const s = spots.get(key)!
          return [s.x - HALF[s.kind] - 0.15, FLY_Y, s.z]
        }

        // Routes between connected pieces, painted on the floor.
        const routes: V3[][] = []
        for (const node of flow.all()) {
          if (!spots.has(node.key)) continue
          for (const target of flow.targets(node.key)) {
            if (!spots.has(target.key)) continue
            const [ax, , az] = exit(node.key)
            const [bx, , bz] = entry(target.key)
            routes.push([
              [ax, 0, az],
              [bx, 0, bz],
            ])
          }
        }

        // Solid things, back to front: pieces and the requests queued at them.
        const solids: { d: number; node: ReactNode }[] = []
        for (const f of task.fixed) {
          solids.push({
            d: depth(f.x, f.z),
            node: <Piece key={f.id} kind={f.kind} x={f.x} z={f.z} node={flow.node(f.id)} active={Math.round(task.rps)} />,
          })
        }
        for (const pad of task.pads) {
          const kind = placed[pad.id]
          if (!kind) continue
          const node = flow.node(pad.id)
          solids.push({
            d: depth(pad.x, pad.z),
            node: (
              <g
                key={`${pad.id}:${kind}`}
                className="cursor-grab active:cursor-grabbing"
                onPointerDown={(e) => {
                  e.stopPropagation()
                  onPieceDown(pad.id, e)
                }}
              >
                <Piece kind={kind} x={pad.x} z={pad.z} node={node} rise={riseOf(`${pad.id}:${kind}`)} />
              </g>
            ),
          })
          if (node instanceof Worker) {
            const overloaded = node.queue.length >= node.queueLimit * 0.75
            node.queue.forEach((job, k) => {
              const qx = pad.x - HALF[kind] - 0.3 - k * QUEUE_GAP
              solids.push({
                d: depth(qx, pad.z),
                node: (
                  <IsoBox
                    key={`q${job.id}`}
                    x={qx}
                    z={pad.z}
                    w={CUBE}
                    d={CUBE}
                    h={CUBE}
                    fill={overloaded ? 'var(--danger)' : 'var(--fg)'}
                  />
                ),
              })
            })
          }
        }
        solids.sort((a, b) => a.d - b.d)

        return (
          <>
            {/* Pads: dashed when empty; outlined in black where the piece being
                dragged could go. */}
            {task.pads.map((pad) => {
              const r = PAD / 2
              const fits = dragKind !== null && pad.accepts.includes(dragKind)
              const hovered = hoverPad === pad.id && fits
              const empty = !placed[pad.id]
              return (
                <polygon
                  key={pad.id}
                  data-pad={pad.id}
                  points={points([
                    [pad.x - r, 0, pad.z - r],
                    [pad.x - r, 0, pad.z + r],
                    [pad.x + r, 0, pad.z + r],
                    [pad.x + r, 0, pad.z - r],
                  ])}
                  fill={hovered ? 'var(--line)' : fits || empty ? 'var(--subtle)' : 'none'}
                  fillOpacity={dragKind !== null && !fits ? 0.3 : 1}
                  stroke={hovered || fits ? 'var(--fg)' : 'var(--muted)'}
                  strokeWidth={hovered ? 2 : 1}
                  strokeDasharray={hovered ? undefined : '6 5'}
                  className="cursor-pointer"
                  onClick={() => onPadClick(pad.id)}
                />
              )
            })}

            {routes.map((route, i) => (
              <FloorPath key={i} route={route} />
            ))}

            {solids.map((s) => s.node)}

            {/* Requests in flight between pieces. */}
            {flow.inTransit.map((t) => {
              if (!spots.has(t.from) || !spots.has(t.to)) return null
              const p = Math.min(1, t.progress + frac / t.ticks)
              const [ax, , az] = exit(t.from)
              const [bx, , bz] = entry(t.to)
              const jitter = (((t.job.id * 37) % 7) - 3) * 0.05
              const x = ax + (bx - ax) * p
              const z = az + (bz - az) * p + jitter
              const y = FLY_Y + Math.sin(p * Math.PI) * 0.3
              return <IsoBox key={t.job.id} x={x} z={z} y={y - CUBE / 2} w={CUBE} d={CUBE} h={CUBE} fill="var(--fg)" />
            })}

            {/* Dropped requests tumble and fade where they were turned away. */}
            {flow.recentDrops.map((d) => {
              const s = spots.get(d.node)
              if (!s) return null
              const age = (flow.tick - d.tick + frac) / TICKS_PER_SECOND
              if (age > FALL_SECONDS) return null
              const side = d.jobId % 2 === 0 ? 1 : -1
              const x0 = d.node === 'users' ? s.x + HALF[s.kind] : s.x - HALF[s.kind] - 0.3 - 8 * QUEUE_GAP
              return (
                <IsoBox
                  key={`d${d.jobId}`}
                  x={x0 - age * 0.6}
                  z={s.z + side * (0.15 + age * 0.9)}
                  y={FLY_Y + age * 1.2 - 5 * age * age}
                  w={CUBE}
                  d={CUBE}
                  h={CUBE}
                  fill="var(--danger)"
                  opacity={1 - age / FALL_SECONDS}
                />
              )
            })}
          </>
        )
      }}
    </Viewport>
  )
}
