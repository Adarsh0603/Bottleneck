import { useRef, type ReactNode } from 'react'
import { depth, points } from '../../core/iso/geometry'
import { Crowd, FloorPath, IsoBox, IsoCylinder, Tag } from '../../core/iso/primitives'
import Viewport from '../../core/iso/Viewport'
import type { SceneProps, V3 } from '../../core/types'
import type { ReplicationSim } from './engine'
import type { Beat, ReplicationState } from './types'
import {
  above,
  APP,
  heightOf,
  HOT,
  LAG_OK,
  MS_PER_TICK,
  PRIMARY,
  PRIMARY_KEY,
  REPLICA,
  spotOf,
  TICKS_PER_SECOND,
  USERS,
} from './world'

const CUBE = 0.22
const FLY_Y = 0.55
const SHIP_Y = 2.2 // changes arc high over the column, from one database to another
const STALE_SECONDS = 0.9
const FALL_SECONDS = 1.2
const RISE_MS = 800
const SLOT = 0.28

export default function Scene({ simRef, lastTickAt, st, beat, shot, shake, quiet, markers }: SceneProps<ReplicationState, ReplicationSim, Beat>) {
  const born = useRef(new Map<string, number>())
  const sim = simRef.current
  if (!sim) return null

  return (
    <Viewport
      target={shot.target}
      zoom={shot.zoom}
      shake={shake}
      panKey={shot}
      label="Isometric view of an app, its primary database and its read replicas."
      markers={markers}
    >
      {({ now }) => {
        const flow = sim.flow
        const frac = Math.min(1, Math.max(0, (now - lastTickAt.current) / MS_PER_TICK))
        const ageOf = (tick: number) => (sim.tick - tick + frac) / TICKS_PER_SECOND
        const m = sim.metrics
        const tags = new Set(beat.tags ?? [])
        const riseOf = (key: string) => {
          if (!born.current.has(key)) born.current.set(key, now)
          const t = Math.min(1, (now - born.current.get(key)!) / RISE_MS)
          return 1 - Math.pow(1 - t, 3)
        }

        const dbs = [PRIMARY_KEY, ...sim.replicas.map((r) => r.key)].filter((k) => sim.inUse(k))
        for (const r of sim.replicas) if (!sim.inUse(r.key)) born.current.delete(r.key)
        const leader = sim.leaderKey
        // Busy most of the time, or a waiting line close to full.
        const workerOf = (key: string) => (key === PRIMARY_KEY ? sim.primary : sim.replicas.find((r) => r.key === key)!)
        const hotNow = (key: string) => {
          const w = workerOf(key)
          return m.load[key] > HOT || w.queue.length >= w.queueLimit * 0.75
        }

        const routes: V3[][] = [
          [
            [USERS.x + 1.1, 0, USERS.z],
            [APP.x - APP.w / 2, 0, APP.z],
          ],
        ]
        for (const key of dbs) {
          const s = spotOf(key)!
          routes.push([
            [APP.x + APP.w / 2, 0, APP.z],
            [s.x, 0, s.z],
          ])
        }

        const solids: { d: number; node: ReactNode }[] = [
          { d: depth(USERS.x, USERS.z), node: <Crowd key="users" x={USERS.x} z={USERS.z} active={Math.round(st.rps)} /> },
          { d: depth(APP.x, APP.z), node: <AppBox key="app" /> },
        ]
        for (const key of dbs) {
          const s = spotOf(key)!
          solids.push({
            d: depth(s.x, s.z),
            node: (
              <Database
                key={key}
                x={s.x}
                z={s.z}
                size={key === PRIMARY_KEY ? PRIMARY : REPLICA}
                busy={workerOf(key).active.length}
                hot={hotNow(key)}
                down={sim.isDown(key)}
                rise={key === PRIMARY_KEY ? 1 : riseOf(key)}
              />
            ),
          })
        }
        solids.sort((a, b) => a.d - b.d)

        const labels: ReactNode[] = []
        if (tags.has('users')) labels.push(<Tag key="users" at={[USERS.x, 1, USERS.z]} label="Users" />)
        if (tags.has('app')) labels.push(<Tag key="app" at={[APP.x, APP.h + 0.5, APP.z]} label="App servers" />)
        if (tags.has('dbs') || tags.has('load')) {
          for (const key of dbs) {
            const down = sim.isDown(key)
            const name = down ? 'Down' : key === leader ? (key === PRIMARY_KEY ? 'Primary' : 'New primary') : `Replica ${sim.replicas.findIndex((r) => r.key === key) + 1}`
            const load = m.load[key]
            // Replicas can say how far behind they are; any database how busy it is.
            const follower = !down && key !== leader && sim.leaderUp
            const label =
              tags.has('load') && !down
                ? `${name} · ${Math.round(load * 100)}%`
                : tags.has('lag') && follower
                  ? `${name} · ${st.lag}s behind`
                  : name
            const late = tags.has('lag') && follower && st.lag > LAG_OK
            labels.push(<Tag key={key} at={above(key, 0.7)} label={label} danger={down || hotNow(key) || late} />)
          }
        }
        if (tags.has('stale')) {
          for (const key of dbs) {
            if (sim.staleEvents.some((e) => e.node === key && ageOf(e.tick) < STALE_SECONDS)) {
              labels.push(<Tag key={`stale-${key}`} at={above(key, 1.5)} label="Stale" danger />)
            }
          }
        }

        return (
          <>
            {routes.map((route, i) => (
              <FloorPath key={i} route={route} />
            ))}
            {solids.map((s) => s.node)}

            {/* Requests on their way: solid reads, outlined writes. */}
            {flow.inTransit.map((t) => {
              const a = spotOf(t.from)
              const b = spotOf(t.to)
              if (!a || !b) return null
              const p = Math.min(1, t.progress + frac / t.ticks)
              const write = sim.kindOf.get(t.job) === 'write'
              return (
                <IsoBox
                  key={t.job.id}
                  x={a.x + (b.x - a.x) * p}
                  z={a.z + (b.z - a.z) * p}
                  y={FLY_Y + Math.sin(p * Math.PI) * 0.3}
                  w={CUBE}
                  d={CUBE}
                  h={CUBE}
                  fill={write ? undefined : 'var(--fg)'}
                />
              )
            })}

            {/* Changes shipping from the leader to each replica, over the column. */}
            {sim.shipping.map((s, i) => {
              const a = spotOf(leader)!
              const b = spotOf(s.to)!
              const p = Math.min(1, (sim.tick - s.sentAt + frac) / (s.arrive - s.sentAt))
              const y0 = heightOf(leader)
              const y1 = heightOf(s.to)
              return (
                <IsoBox
                  key={`s${i}-${s.sentAt}-${s.to}`}
                  x={a.x + (b.x - a.x) * p}
                  z={a.z + (b.z - a.z) * p}
                  y={y0 + (y1 - y0) * p + Math.sin(p * Math.PI) * (SHIP_Y - y0)}
                  w={0.16}
                  d={0.16}
                  h={0.16}
                />
              )
            })}

            {/* A stale answer: a red cube pops up from the replica that gave it. */}
            {sim.staleEvents.map((e, i) => {
              const age = ageOf(e.tick)
              if (age > STALE_SECONDS) return null
              const s = spotOf(e.node)!
              return (
                <IsoBox
                  key={`st${i}-${e.tick}`}
                  x={s.x}
                  z={s.z}
                  y={heightOf(e.node) + 0.4 + age * 1.2}
                  w={CUBE}
                  d={CUBE}
                  h={CUBE}
                  fill="var(--danger)"
                  opacity={1 - age / STALE_SECONDS}
                />
              )
            })}

            {/* Turned-away requests tumble in front of the database that couldn't take them. */}
            {flow.recentDrops.map((d) => {
              const age = ageOf(d.tick)
              if (age > FALL_SECONDS) return null
              const s = spotOf(d.node)
              if (!s) return null
              const side = d.jobId % 2 === 0 ? 1 : -1
              return (
                <IsoBox
                  key={`d${d.jobId}`}
                  x={s.x - 1.1 - age * 0.6}
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

// A database: a cylinder with its worker slots on the lid, lit while busy.
function Database({
  x,
  z,
  size,
  busy,
  hot,
  down,
  rise,
}: {
  x: number
  z: number
  size: { r: number; h: number }
  busy: number
  hot: boolean
  down: boolean
  rise: number
}) {
  const h = size.h * rise
  if (down) return <IsoCylinder x={x} z={z} r={size.r} h={h} dim stroke="var(--danger)" />
  const d = size.r * 0.32
  const slots = [
    [-d, -d],
    [d, -d],
    [-d, d],
    [d, d],
  ].sort((a, b) => depth(a[0], a[1]) - depth(b[0], b[1]))
  return (
    <g>
      <IsoCylinder x={x} z={z} r={size.r} h={h} stroke={hot ? 'var(--danger)' : 'var(--fg)'} />
      {rise === 1 &&
        slots.map(([dx, dz], i) => (
          <IsoBox key={i} x={x + dx} z={z + dz} y={h} w={SLOT} d={SLOT} h={SLOT} fill={i < busy ? 'var(--fg)' : undefined} />
        ))}
    </g>
  )
}
