import { useRef, type ReactNode } from 'react'
import { depth, points } from '../../core/iso/geometry'
import { Crowd, FloorPath, FloorSpot, IsoBox, IsoCylinder, Tag } from '../../core/iso/primitives'
import Viewport from '../../core/iso/Viewport'
import type { SceneProps, V3 } from '../../core/types'
import { MS_PER_TICK, TICKS_PER_SECOND, type CachingSim } from './engine'
import type { Beat, CachingState } from './types'
import {
  APP,
  CACHE,
  cellSpot,
  CUBE,
  DB,
  dbOverloaded,
  dbQueueSpot,
  dropPoint,
  FALL_SECONDS,
  flightPoint,
  HIT_SECONDS,
  hitPoint,
  USERS_X,
  WAIT_SPOT,
} from './world'

const RISE_MS = 900
const SLOT = 0.3

export default function Scene({ simRef, lastTickAt, st, beat, shot, shake, quiet, markers }: SceneProps<CachingState, CachingSim, Beat>) {
  const born = useRef(new Map<string, number>())
  const sim = simRef.current
  if (!sim) return null

  return (
    <Viewport
      target={shot.target}
      zoom={shot.zoom}
      shake={shake}
      panKey={shot}
      label="Isometric view of an app, its cache and its database."
      markers={markers}
    >
      {({ now }) => {
        const riseOf = (key: string) => {
          if (!born.current.has(key)) born.current.set(key, now)
          const t = Math.min(1, (now - born.current.get(key)!) / RISE_MS)
          return 1 - Math.pow(1 - t, 3)
        }
        const frac = Math.min(1, Math.max(0, (now - lastTickAt.current) / MS_PER_TICK))
        const ageOf = (tick: number) => (sim.tick - tick + frac) / TICKS_PER_SECOND
        const tags = new Set(beat.tags ?? [])
        const showCache = st.cache
        const cacheUp = showCache && !st.cacheDown
        const overloaded = dbOverloaded(sim)
        const limit = sim.db.queueLimit

        if (!showCache) born.current.delete('cache')

        const routes: V3[][] = [
          [
            [USERS_X + 1.1, 0, 0],
            [APP.x - APP.w / 2, 0, 0],
          ],
          [
            [APP.x + APP.w / 2, 0, 0],
            [DB.x - DB.r, 0, 0],
          ],
        ]

        // Solid objects, painted back to front.
        const solids: { d: number; node: ReactNode }[] = [
          { d: depth(USERS_X, 0), node: <Crowd key="users" x={USERS_X} active={Math.round(st.rps)} /> },
          { d: depth(APP.x, 0), node: <AppBox key="app" /> },
          { d: depth(DB.x, 0), node: <Database key="db" sim={sim} overloaded={overloaded} /> },
        ]
        sim.db.queue.forEach((job, k) => {
          const [x, , z] = dbQueueSpot(k)
          solids.push({
            d: depth(x, z),
            node: <IsoBox key={`q${job.id}`} x={x} z={z} w={CUBE} d={CUBE} h={CUBE} fill={overloaded ? 'var(--danger)' : 'var(--fg)'} />,
          })
        })
        if (showCache) {
          solids.push({
            d: depth(CACHE.x, 0),
            node: <CacheBox key="cache" sim={sim} st={st} rise={riseOf('cache')} ageOf={ageOf} />,
          })
        }
        solids.sort((a, b) => a.d - b.d)

        // Requests waiting on someone else's fetch, stacked beside the cache.
        const waiting = cacheUp ? sim.cache.load() : 0

        const labels: ReactNode[] = []
        const tag = (key: string, at: V3, label: string, danger?: boolean) =>
          labels.push(<Tag key={key} at={at} label={label} danger={danger} />)
        if (tags.has('users')) tag('users', [USERS_X, 1, 0], 'Users')
        if (tags.has('app')) tag('app', [APP.x, APP.h + 0.5, 0], 'App servers')
        if (tags.has('db')) tag('db', [DB.x, DB.h + 0.7, 0], 'Database')
        if (showCache && st.cacheDown) tag('down', [CACHE.x, CACHE.h + 0.8, 0], 'Down', true)
        else if (tags.has('cache') && showCache) tag('cache', [CACHE.x, CACHE.h + 0.9, 0], `Cache · ${sim.cache.entries.size}/${st.capacity}`)
        if (tags.has('hit') && cacheUp) tag('hit', [(APP.x + CACHE.x) / 2, 1.3, 0], 'Hit · answered from memory')
        if (tags.has('miss') && cacheUp) tag('miss', [(CACHE.x + DB.x) / 2 - 0.4, 1.3, 0], 'Miss · ask the database')
        if (tags.has('queue')) tag('queue', [dbQueueSpot((limit - 1) / 2)[0], 0.75, 0], `Queue · ${sim.db.queue.length}/${limit}`, overloaded)
        // In front of the queue's end, where the red cubes fall, clear of the queue label.
        if (tags.has('dropped') && overloaded) tag('dropped', [dbQueueSpot(limit)[0] - 0.5, 0.3, 1], 'Dropped', true)
        if (tags.has('lru') && cacheUp && sim.cache.entries.size > 0) tag('lru', cellSpot(0), 'Evicted next')
        if (tags.has('waiting') && waiting > 0) tag('waiting', [WAIT_SPOT[0], waiting * 0.26 + 0.4, WAIT_SPOT[2]], `Waiting · ${waiting}`)

        return (
          <>
            {routes.map((route, i) => (
              <FloorPath key={i} route={route} />
            ))}
            {Array.from({ length: limit }, (_, k) => {
              const [x, , z] = dbQueueSpot(k)
              return <FloorSpot key={k} x={x} z={z} size={CUBE + 0.08} />
            })}

            {solids.map((s) => s.node)}

            {Array.from({ length: Math.min(waiting, 12) }, (_, k) => (
              <IsoBox key={`w${k}`} x={WAIT_SPOT[0]} z={WAIT_SPOT[2]} y={k * 0.26} w={CUBE} d={CUBE} h={CUBE} fill="var(--muted)" />
            ))}

            {/* Requests in flight. */}
            {sim.flow.inTransit.map((t) => {
              const p = Math.min(1, t.progress + frac / t.ticks)
              const [x, y, z] = flightPoint(t.from, t.to, p, t.job.id)
              return <IsoBox key={t.job.id} x={x} z={z} y={y - CUBE / 2} w={CUBE} d={CUBE} h={CUBE} fill="var(--fg)" />
            })}

            {/* Hits bounce back from the cache; evicted and expired items pop off its lid. */}
            {cacheUp &&
              sim.cache.events.map((e, i) => {
                const age = ageOf(e.tick)
                if (e.kind === 'hit') {
                  if (age > HIT_SECONDS) return null
                  const [x, y, z] = hitPoint(age, e.jobId ?? i)
                  return (
                    <IsoBox key={`h${i}-${e.tick}`} x={x} z={z} y={y - CUBE / 2} w={CUBE} d={CUBE} h={CUBE} fill="var(--fg)" opacity={1 - age / HIT_SECONDS} />
                  )
                }
                if (age > 0.8) return null
                const [x, y, z] = cellSpot(0)
                return (
                  <IsoBox
                    key={`e${i}-${e.tick}`}
                    x={x}
                    z={z}
                    y={y + age * 1.4}
                    w={0.16}
                    d={0.24}
                    h={0.12}
                    fill={e.kind === 'evict' ? 'var(--fg)' : 'var(--muted)'}
                    opacity={1 - age / 0.8}
                  />
                )
              })}

            {/* Dropped requests tumble and fade. */}
            {sim.flow.recentDrops.map((d) => {
              const age = ageOf(d.tick)
              if (age > FALL_SECONDS) return null
              const [x, y, z] = dropPoint(d.node, age, d.jobId)
              return (
                <IsoBox key={`d${d.jobId}`} x={x} z={z} y={y} w={CUBE} d={CUBE} h={CUBE} fill="var(--danger)" opacity={1 - age / FALL_SECONDS} />
              )
            })}

            {/* Labels could give a question's answer away, so they wait. */}
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
      <IsoBox x={APP.x} z={0} w={APP.w} d={APP.d} h={APP.h} />
      {[0.3, 0.6, 0.9, 1.2].map((y) => (
        <polyline
          key={y}
          points={points([
            [x0, y, -APP.d * 0.32],
            [x0, y, APP.d * 0.32],
          ])}
          stroke="var(--line)"
          strokeWidth={3}
          strokeLinecap="round"
        />
      ))}
    </g>
  )
}

function Database({ sim, overloaded }: { sim: CachingSim; overloaded: boolean }) {
  const stroke = overloaded ? 'var(--danger)' : 'var(--fg)'
  const slots = [
    [-0.28, -0.28],
    [0.28, -0.28],
    [-0.28, 0.28],
    [0.28, 0.28],
  ].sort((a, b) => depth(a[0], a[1]) - depth(b[0], b[1]))
  return (
    <g>
      <IsoCylinder x={DB.x} z={0} r={DB.r} h={DB.h} stroke={stroke} />
      {slots.map(([dx, dz], i) => (
        <IsoBox
          key={i}
          x={DB.x + dx}
          z={dz}
          y={DB.h}
          w={SLOT}
          d={SLOT}
          h={SLOT}
          fill={i < sim.db.active.length ? 'var(--fg)' : undefined}
        />
      ))}
    </g>
  )
}

function CacheBox({
  sim,
  st,
  rise,
  ageOf,
}: {
  sim: CachingSim
  st: CachingState
  rise: number
  ageOf: (tick: number) => number
}) {
  const h = CACHE.h * rise
  if (st.cacheDown) return <IsoBox x={CACHE.x} z={0} w={CACHE.w} d={CACHE.d} h={h} dim stroke="var(--muted)" />

  const entries = [...sim.cache.entries.values()]
  const ttlSeconds = st.ttl > 0 ? st.ttl : Infinity
  return (
    <g>
      <IsoBox x={CACHE.x} z={0} w={CACHE.w} d={CACHE.d} h={h} />
      {/* Lightning mark on the front: fast memory. */}
      {rise === 1 && (
        <polyline
          points={points([
            [CACHE.x - CACHE.w / 2, h * 0.85, -0.05],
            [CACHE.x - CACHE.w / 2, h * 0.45, 0.12],
            [CACHE.x - CACHE.w / 2, h * 0.55, -0.12],
            [CACHE.x - CACHE.w / 2, h * 0.15, 0.05],
          ])}
          stroke="var(--fg)"
          strokeWidth={2}
          fill="none"
          strokeLinejoin="round"
        />
      )}
      {/* Memory cells on the lid: one per item it can hold; filled when used,
          fading as the item ages toward its TTL. Least recently used first. */}
      {rise === 1 &&
        Array.from({ length: st.capacity }, (_, i) => {
          const [x, y, z] = cellSpot(i)
          const entry = entries[i]
          const fresh = entry ? 1 - Math.min(1, ageOf(entry.storedAt) / ttlSeconds) * 0.7 : 0
          const r = { w: 0.08, d: 0.12 }
          return (
            <polygon
              key={i}
              points={points([
                [x - r.w, y, z - r.d],
                [x - r.w, y, z + r.d],
                [x + r.w, y, z + r.d],
                [x + r.w, y, z - r.d],
              ])}
              fill={entry ? 'var(--fg)' : 'var(--subtle)'}
              fillOpacity={entry ? fresh : 1}
              stroke="var(--line)"
              strokeWidth={0.6}
            />
          )
        })}
    </g>
  )
}
