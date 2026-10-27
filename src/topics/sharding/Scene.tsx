import { useRef, type ReactNode } from 'react'
import { depth, points } from '../../core/iso/geometry'
import { Crowd, FloorPath, IsoBox, IsoCylinder, Packet, Tag } from '../../core/iso/primitives'
import { crowd, edge, glide } from '../../core/iso/crowd'
import Viewport from '../../core/iso/Viewport'
import type { SceneProps, V3 } from '../../core/types'
import { CELEBRITY, holdsOf, shardOf, type ShardingSim } from './engine'
import type { Beat, ShardingState } from './types'
import { APP, DB_X, HOT, MS_PER_TICK, SHARD, shardIndex, shardKey, shardSpot, TICKS_PER_SECOND, USERS } from './world'

const FLY_Y = 0.55
const FALL_SECONDS = 1.2
const RISE_MS = 800
const SLIDE = 0.15 // how far shards slide toward their new spot each frame
const SLOT = 0.28

export default function Scene({ simRef, lastTickAt, st, beat, shot, shake, quiet, markers }: SceneProps<ShardingState, ShardingSim, Beat>) {
  const born = useRef(new Map<string, number>())
  const shownZ = useRef(new Map<string, number>())
  const sim = simRef.current
  if (!sim) return null

  return (
    <Viewport
      target={shot.target}
      zoom={shot.zoom}
      shake={shake}
      panKey={shot}
      label="Isometric view of an app and its database split into shards."
      markers={markers}
    >
      {({ now }) => {
        const flow = sim.flow
        const frac = Math.min(1, Math.max(0, (now - lastTickAt.current) / MS_PER_TICK))
        const c = crowd(flow.inTransit.length)
        const ageOf = (tick: number) => (sim.tick - tick + frac) / TICKS_PER_SECOND
        const m = sim.metrics
        const tags = new Set(beat.tags ?? [])
        const n = sim.count
        const riseOf = (key: string) => {
          if (!born.current.has(key)) born.current.set(key, now)
          const t = Math.min(1, (now - born.current.get(key)!) / RISE_MS)
          return 1 - Math.pow(1 - t, 3)
        }

        // Shards re-centre as the count changes; slide them there.
        const keys = Array.from({ length: n }, (_, i) => shardKey(i))
        for (const [i, key] of keys.entries()) {
          const target = shardSpot(i, n).z
          const z = shownZ.current.get(key)
          shownZ.current.set(key, z === undefined ? target : z + (target - z) * SLIDE)
        }
        for (const s of sim.shards.slice(n)) {
          born.current.delete(s.key)
          shownZ.current.delete(s.key)
        }
        const spotOf = (key: string): { x: number; z: number } | undefined => {
          if (key === 'users') return USERS
          if (key === 'app') return APP
          const z = shownZ.current.get(key)
          return z === undefined ? undefined : { x: DB_X, z }
        }
        const hotNow = (i: number) => {
          const w = sim.shards[i]
          if (!w.alive) return false
          return m.load[w.key] > HOT || w.queue.length >= w.queueLimit * 0.75
        }

        const routes: V3[][] = [
          [
            [USERS.x + 1.1, 0, USERS.z],
            [APP.x - APP.w / 2, 0, APP.z],
          ],
        ]
        for (const key of keys) {
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
        for (const [i, key] of keys.entries()) {
          const s = spotOf(key)!
          solids.push({
            d: depth(s.x, s.z),
            node: (
              <Database
                key={key}
                x={s.x}
                z={s.z}
                busy={sim.shards[i].active.length}
                hot={hotNow(i)}
                down={sim.down === i}
                rise={i === 0 ? 1 : riseOf(key)}
              />
            ),
          })
        }
        solids.sort((a, b) => a.d - b.d)

        const labels: ReactNode[] = []
        if (tags.has('users')) labels.push(<Tag key="users" at={[USERS.x, 1, USERS.z]} label="Users" />)
        if (tags.has('app')) {
          const label = sim.cached ? 'App servers · celebrity cached' : 'App servers'
          labels.push(<Tag key="app" at={[APP.x, APP.h + 0.5, APP.z]} label={label} />)
        }
        const celebrityShard = sim.celebrity ? shardOf(CELEBRITY, n, sim.key) : -1
        if (tags.has('dbs') || tags.has('load') || tags.has('keys') || tags.has('celebrity')) {
          for (const [i, key] of keys.entries()) {
            const s = spotOf(key)!
            const name = n === 1 ? 'Database' : `Shard ${i + 1}`
            const holds = n === 1 ? 'all users' : `users ${holdsOf(i, n, sim.key)}`
            const down = sim.down === i
            const who = tags.has('celebrity') && i === celebrityShard ? `${name} · celebrity` : name
            const label = down
              ? `${name} · Down`
              : tags.has('load')
                ? `${who} · ${Math.round(m.load[key] * 100)}%`
                : tags.has('keys')
                  ? `${name} · ${holds}`
                  : who
            labels.push(<Tag key={key} at={[s.x, SHARD.h + 0.7, s.z]} label={label} danger={down || hotNow(i)} />)
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
              const p = glide(Math.min(1, t.progress + frac / t.ticks))
              const write = sim.kindOf.get(t.job) === 'write'
              return (
                <Packet key={t.job.id} at={[a.x + (b.x - a.x) * p, FLY_Y + Math.sin(p * Math.PI) * 0.3, a.z + (b.z - a.z) * p]} scale={c.scale} fill={write ? undefined : 'var(--fg)'} opacity={c.opacity * edge(p)} />
              )
            })}

            {/* Turned-away requests tumble in front of the shard that couldn't take them. */}
            {flow.recentDrops.map((d) => {
              const age = ageOf(d.tick)
              if (age > FALL_SECONDS || shardIndex(d.node) >= n) return null
              const s = spotOf(d.node)
              if (!s) return null
              const side = d.jobId % 2 === 0 ? 1 : -1
              return (
                <Packet key={`d${d.jobId}`} at={[s.x - 1.1 - age * 0.6, FLY_Y + age * 1.2 - 5 * age * age, s.z + side * (0.15 + age * 0.8)]} fill="var(--danger)" opacity={1 - age / FALL_SECONDS} />
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

// A shard: a database cylinder with its worker slots on the lid, lit while busy.
function Database({ x, z, busy, hot, down, rise }: { x: number; z: number; busy: number; hot: boolean; down: boolean; rise: number }) {
  const h = SHARD.h * rise
  if (down) return <IsoCylinder x={x} z={z} r={SHARD.r} h={h} dim stroke="var(--danger)" />
  const d = SHARD.r * 0.32
  const slots = [
    [-d, -d],
    [d, -d],
    [-d, d],
    [d, d],
  ].sort((a, b) => depth(a[0], a[1]) - depth(b[0], b[1]))
  return (
    <g>
      <IsoCylinder x={x} z={z} r={SHARD.r} h={h} stroke={hot ? 'var(--danger)' : 'var(--fg)'} />
      {rise === 1 &&
        slots.map(([dx, dz], i) => (
          <IsoBox key={i} x={x + dx} z={z + dz} y={h} w={SLOT} d={SLOT} h={SLOT} fill={i < busy ? 'var(--fg)' : undefined} />
        ))}
    </g>
  )
}
