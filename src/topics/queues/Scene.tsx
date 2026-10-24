import { useRef, type ReactNode } from 'react'
import { depth, points } from '../../core/iso/geometry'
import { Crowd, FloorPath, IsoBox, Tag } from '../../core/iso/primitives'
import { crowd, edge, glide } from '../../core/iso/crowd'
import Viewport from '../../core/iso/Viewport'
import type { SceneProps, V3 } from '../../core/types'
import type { QueueSim } from './engine'
import type { Beat, QueueState } from './types'
import { aboveWorker, APP, DEAD, HOT, MAX_WORKERS, MS_PER_TICK, QUEUE, QUEUE_IN, QUEUE_OUT, spotOf, TICKS_PER_SECOND, USERS, WORKER, workerIndex, workerSpot } from './world'

const CUBE = 0.22
const FLY_Y = 0.55
const FALL_SECONDS = 1.2
const RISE_MS = 800
const SLOT = 0.28
const CELLS = 16
const DEAD_ROWS = 4

export default function Scene({ simRef, lastTickAt, st, beat, shot, shake, quiet, markers }: SceneProps<QueueState, QueueSim, Beat>) {
  const born = useRef(new Map<number, number>())
  const sim = simRef.current
  if (!sim) return null

  return (
    <Viewport
      target={shot.target}
      zoom={shot.zoom}
      shake={shake}
      panKey={shot}
      label="Isometric view of users, an app server, a queue and a column of workers."
      markers={markers}
    >
      {({ now }) => {
        const flow = sim.flow
        const frac = Math.min(1, Math.max(0, (now - lastTickAt.current) / MS_PER_TICK))
        const c = crowd(flow.inTransit.length)
        const m = sim.metrics
        const tags = new Set(beat.tags ?? [])
        // New workers rise into place.
        const riseOf = (i: number) => {
          if (!born.current.has(i)) born.current.set(i, now)
          const t = Math.min(1, (now - born.current.get(i)!) / RISE_MS)
          return 1 - Math.pow(1 - t, 3)
        }
        const hotNow = (i: number) => {
          const w = sim.workers[i]
          return m.load > HOT && w.active.length >= w.slots
        }

        const used = Array.from({ length: MAX_WORKERS }, (_, i) => i).filter((i) => sim.inUse(i))
        for (let i = 0; i < MAX_WORKERS; i++) if (!sim.inUse(i)) born.current.delete(i)
        const routes: V3[][] = [
          [[USERS.x + 1.1, 0, USERS.z], [APP.x - APP.w / 2, 0, APP.z]],
        ]
        if (st.queued) {
          routes.push([[APP.x + APP.w / 2, 0, APP.z], [QUEUE_IN.x, 0, QUEUE_IN.z]])
          for (const i of used) routes.push([[QUEUE_OUT.x, 0, QUEUE_OUT.z], [workerSpot(i).x, 0, workerSpot(i).z]])
        } else {
          for (const i of used) routes.push([[APP.x + APP.w / 2, 0, APP.z], [workerSpot(i).x, 0, workerSpot(i).z]])
        }

        const solids: { d: number; node: ReactNode }[] = [
          { d: depth(USERS.x, USERS.z), node: <Crowd key="users" x={USERS.x} z={USERS.z} active={Math.round(st.rps)} /> },
          { d: depth(APP.x, APP.z), node: <AppBox key="app" /> },
          { d: depth(QUEUE.x, QUEUE.z), node: <Trough key="queue" sim={sim} on={st.queued} /> },
          { d: depth(DEAD.x, DEAD.z), node: <DeadLetter key="dead" parked={sim.parked} on={st.deadLetter} /> },
        ]
        for (const i of used) {
          const s = workerSpot(i)
          solids.push({ d: depth(s.x, s.z), node: <WorkerBox key={i} x={s.x} z={s.z} busy={sim.workers[i].active.length} hot={hotNow(i)} rise={riseOf(i)} /> })
        }
        solids.sort((a, b) => a.d - b.d)

        const labels: ReactNode[] = []
        if (tags.has('users')) labels.push(<Tag key="users" at={[USERS.x, 1, USERS.z]} label="Users" />)
        if (tags.has('app')) labels.push(<Tag key="app" at={[APP.x, APP.h + 0.5, APP.z]} label="App server" />)
        if (tags.has('queue')) {
          labels.push(
            <Tag
              key="queue"
              at={[QUEUE.x, QUEUE.h + 0.8, QUEUE.z]}
              label={st.queued ? `Queue · ${sim.fifo.jobs.length} waiting` : 'No queue'}
              danger={st.queued && sim.fifo.jobs.length >= sim.fifo.capacity * 0.9}
            />,
          )
        }
        if (tags.has('workers') || tags.has('load')) {
          for (const i of used) {
            const label = tags.has('load') ? `Worker ${i + 1} · ${Math.round(sim.workers[i].active.length / sim.workers[i].slots * 100)}%` : `Worker ${i + 1}`
            labels.push(<Tag key={`w${i}`} at={aboveWorker(i, 0.7)} label={label} danger={hotNow(i)} />)
          }
        }
        if (tags.has('dead')) {
          labels.push(<Tag key="dead" at={[DEAD.x, DEAD.h + 0.9, DEAD.z]} label={st.deadLetter ? `Dead-letter · ${sim.parked}` : 'No dead-letter box'} danger={sim.parked > 0} />)
        }

        return (
          <>
            {routes.map((route, i) => (
              <FloorPath key={i} route={route} />
            ))}
            {solids.map((s) => s.node)}

            {/* Jobs on their way. */}
            {flow.inTransit.map((t) => {
              const a = spotOf(t.from, 'out')
              const b = spotOf(t.to, 'in')
              if (!a || !b) return null
              const p = glide(Math.min(1, t.progress + frac / t.ticks))
              return (
                <IsoBox
                  key={t.job.id}
                  x={a.x + (b.x - a.x) * p}
                  z={a.z + (b.z - a.z) * p}
                  y={FLY_Y + Math.sin(p * Math.PI) * 0.3}
                  w={CUBE * c.scale}
                  d={CUBE * c.scale}
                  h={CUBE * c.scale}
                  fill="var(--fg)"
                  opacity={c.opacity * edge(p)}
                />
              )
            })}

            {/* Turned-away jobs tumble where they were refused. */}
            {flow.recentDrops.map((d) => {
              const age = (sim.tick - d.tick + frac) / TICKS_PER_SECOND
              if (age > FALL_SECONDS) return null
              const s = spotOf(d.node, 'in')
              if (!s) return null
              const side = d.jobId % 2 === 0 ? 1 : -1
              const w = workerIndex(d.node) >= 0
              return (
                <IsoBox
                  key={`d${d.jobId}`}
                  x={s.x - (w ? 1.1 : 0.6) - age * 0.6}
                  z={s.z + side * (0.15 + age * 0.8)}
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

function AppBox() {
  const x0 = APP.x - APP.w / 2
  return (
    <g>
      <IsoBox x={APP.x} z={APP.z} w={APP.w} d={APP.w} h={APP.h} />
      {[0.3, 0.6, 0.9, 1.2].map((y) => (
        <polyline
          key={y}
          points={points([
            [x0, y, APP.z - APP.w * 0.32],
            [x0, y, APP.z + APP.w * 0.32],
          ])}
          stroke="var(--line)"
          strokeWidth={3}
          strokeLinecap="round"
        />
      ))}
    </g>
  )
}

// The queue: a long trough with a cell for every share of its capacity,
// filled from the worker end as jobs wait. Ghosted when there isn't one.
function Trough({ sim, on }: { sim: QueueSim; on: boolean }) {
  const filled = Math.ceil((sim.fifo.jobs.length / sim.fifo.capacity) * CELLS)
  const cell = QUEUE.len / CELLS
  const full = sim.fifo.jobs.length >= sim.fifo.capacity * 0.9
  return (
    <g>
      <IsoBox x={QUEUE.x} z={QUEUE.z} w={QUEUE.len} d={QUEUE.wid} h={QUEUE.h} ghost={!on} stroke={full ? 'var(--danger)' : undefined} />
      {on &&
        Array.from({ length: CELLS }, (_, i) => {
          const cx = QUEUE.x + QUEUE.len / 2 - cell * (i + 0.5)
          return (
            <polygon
              key={i}
              points={points([
                [cx - cell * 0.4, QUEUE.h, QUEUE.z - QUEUE.wid * 0.35],
                [cx - cell * 0.4, QUEUE.h, QUEUE.z + QUEUE.wid * 0.35],
                [cx + cell * 0.4, QUEUE.h, QUEUE.z + QUEUE.wid * 0.35],
                [cx + cell * 0.4, QUEUE.h, QUEUE.z - QUEUE.wid * 0.35],
              ])}
              fill={i < filled ? (full ? 'var(--danger)' : 'var(--fg)') : 'var(--subtle)'}
              stroke="var(--line)"
              strokeWidth={0.6}
            />
          )
        })}
    </g>
  )
}

// Where jobs that gave up are parked: a small box, red cubes stacking on it.
function DeadLetter({ parked, on }: { parked: number; on: boolean }) {
  const shown = Math.min(parked, DEAD_ROWS * 3)
  return (
    <g>
      <IsoBox x={DEAD.x} z={DEAD.z} w={DEAD.size} d={DEAD.size} h={DEAD.h} ghost={!on} stroke={on && parked > 0 ? 'var(--danger)' : undefined} />
      {on &&
        Array.from({ length: shown }, (_, i) => (
          <IsoBox
            key={i}
            x={DEAD.x - 0.3 + (i % 3) * 0.3}
            z={DEAD.z}
            y={DEAD.h + Math.floor(i / 3) * 0.16}
            w={0.2}
            d={0.4}
            h={0.14}
            fill="var(--danger)"
          />
        ))}
    </g>
  )
}

// A worker: a box with two job slots on top, lit while busy.
function WorkerBox({ x, z, busy, hot, rise }: { x: number; z: number; busy: number; hot: boolean; rise: number }) {
  const h = WORKER.h * rise
  const x0 = x - WORKER.w / 2
  return (
    <g>
      <IsoBox x={x} z={z} w={WORKER.w} d={WORKER.w} h={h} stroke={hot ? 'var(--danger)' : 'var(--fg)'} />
      {rise === 1 &&
        [0.22, 0.42, 0.62, 0.82].map((f) => (
          <polyline
            key={f}
            points={points([
              [x0, WORKER.h * f, z - WORKER.w * 0.3],
              [x0, WORKER.h * f, z + WORKER.w * 0.3],
            ])}
            stroke="var(--line)"
            strokeWidth={2.5}
            strokeLinecap="round"
          />
        ))}
      {rise === 1 &&
        [-0.22, 0.22].map((dz, i) => (
          <IsoBox key={i} x={x} z={z + dz} y={h} w={SLOT} d={SLOT} h={SLOT} fill={i < busy ? 'var(--fg)' : undefined} />
        ))}
    </g>
  )
}
