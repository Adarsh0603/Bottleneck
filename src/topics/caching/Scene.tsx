import { useRef, type ReactNode } from 'react'
import { depth, points, project } from '../../core/iso/geometry'
import { Crowd, FloorPath, FloorSpot, IsoBox, IsoCylinder, Packet, Tag } from '../../core/iso/primitives'
import { crowd, edge, glide } from '../../core/iso/crowd'
import Viewport from '../../core/iso/Viewport'
import type { SceneProps, V3 } from '../../core/types'
import { FILL_TICKS, MS_PER_TICK, share, TICKS_PER_SECOND, type CachingSim } from './engine'
import type { Beat, CachingState } from './types'
import {
  APP,
  BARS,
  barSpot,
  CACHE,
  cellSpot,
  CUBE,
  DB,
  dbOverloaded,
  dbQueueSpot,
  dropPoint,
  FALL_SECONDS,
  fillPoint,
  flightPoint,
  HIT_SECONDS,
  hitPoint,
  MARKED_CUBE,
  markOf,
  USERS_X,
  WAIT_SPOT,
} from './world'

const RISE_MS = 900
const SLOT = 0.3
const FILL_SECONDS = FILL_TICKS / TICKS_PER_SECOND
const PULSE_SECONDS = 0.35
const SLIDE_MS = 300

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
        const c = crowd(sim.flow.inTransit.length)
        const ageOf = (tick: number) => (sim.tick - tick + frac) / TICKS_PER_SECOND
        const tags = new Set(beat.tags ?? [])
        const showCache = st.cache
        const cacheUp = showCache && !st.cacheDown
        const overloaded = dbOverloaded(sim)
        const limit = sim.db.queueLimit

        if (!showCache) born.current.delete('cache')
        // Which cell each cached item sits in: least recently used first.
        const cellOf = new Map([...sim.cache.entries.keys()].map((k, i) => [k, i]))

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
            node: <ItemCube key={`q${job.id}`} x={x} z={z} y={0} item={job.key} fill={overloaded ? 'var(--danger)' : 'var(--fg)'} />,
          })
        })
        if (showCache) {
          solids.push({
            d: depth(CACHE.x, 0),
            node: <CacheBox key="cache" sim={sim} st={st} rise={riseOf('cache')} ageOf={ageOf} now={now} />,
          })
        }
        // The popularity chart: a cached item's bar is solid, the rest grey.
        if (tags.has('popularity')) {
          const top = share(0)
          for (let item = 0; item < BARS.count; item++) {
            const { x, z } = barSpot(item)
            const cached = cacheUp && sim.cache.entries.has(item)
            solids.push({
              d: depth(x, z),
              node: <Bar key={`bar${item}`} x={x} z={z} h={(share(item) / top) * BARS.maxH} item={item} cached={cached} />,
            })
          }
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
        if (tags.has('stale') && cacheUp && sim.staleHits.some((s) => ageOf(s.tick) < HIT_SECONDS)) {
          tag('stale', [(APP.x + CACHE.x) / 2, 1.3, 0], 'Stale · old copy', true)
        }
        if (tags.has('hit') && cacheUp) tag('hit', [(APP.x + CACHE.x) / 2, 1.3, 0], 'Hit · answered from memory')
        if (tags.has('miss') && cacheUp) tag('miss', [(CACHE.x + DB.x) / 2 - 0.4, 1.3, 0], 'Miss · ask the database')
        if (tags.has('queue')) tag('queue', [dbQueueSpot((limit - 1) / 2)[0], 0.75, 0], `Queue · ${sim.db.queue.length}/${limit}`, overloaded)
        // In front of the queue's end, where the red cubes fall, clear of the queue label.
        if (tags.has('dropped') && overloaded) tag('dropped', [dbQueueSpot(limit)[0] - 0.5, 0.3, 1], 'Dropped', true)
        if (tags.has('lru') && cacheUp && sim.cache.entries.size > 0) {
          const [x, y, z] = cellSpot(0)
          // High enough that the pill doesn't hide the row of cells.
          tag('lru', [x, y + 1.1, z], 'Evicted next')
        }
        if (tags.has('popularity')) tag('popularity', [BARS.x, BARS.maxH + 0.5, BARS.z], 'Requests per item')
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
              <Packet key={`w${k}`} at={[WAIT_SPOT[0], k * 0.26, WAIT_SPOT[2]]} fill="var(--muted)" />
            ))}

            {/* Requests in flight. */}
            {sim.flow.inTransit.map((t) => {
              const p = glide(Math.min(1, t.progress + frac / t.ticks))
              const [x, y, z] = flightPoint(t.from, t.to, p, t.job.id)
              return <ItemCube key={t.job.id} x={x} z={z} y={y - CUBE / 2} item={t.job.key} opacity={c.opacity * edge(p)} />
            })}

            {/* Hits bounce back from the cache; evicted and expired items pop off its lid. */}
            {cacheUp &&
              sim.cache.events.map((e, i) => {
                const age = ageOf(e.tick)
                if (e.kind === 'hit') {
                  if (age > HIT_SECONDS) return null
                  const [x, y, z] = hitPoint(age, e.jobId ?? i)
                  const stale = sim.staleHits.some((s) => s.jobId === e.jobId && s.tick === e.tick)
                  return (
                    <ItemCube
                      key={`h${i}-${e.tick}`}
                      x={x}
                      z={z}
                      y={y - CUBE / 2}
                      item={e.key}
                      fill={stale ? 'var(--danger)' : undefined}
                      opacity={1 - age / HIT_SECONDS}
                    />
                  )
                }
                // Evicted (from the least-recent end) or expired: the item pops off the lid.
                if (age > 0.8) return null
                const [x, y, z] = cellSpot(0)
                return (
                  <ItemCube
                    key={`e${i}-${e.tick}`}
                    x={x - age * 0.6}
                    z={z - age * 0.4}
                    y={y + age * 1.6}
                    item={e.key}
                    fill={e.kind === 'evict' ? 'var(--fg)' : 'var(--muted)'}
                    opacity={1 - age / 0.8}
                  />
                )
              })}

            {/* A miss's answer flies back from the database and drops into its cell. */}
            {cacheUp &&
              sim.fills.map((f) => {
                const age = ageOf(f.tick)
                const cell = cellOf.get(f.key)
                if (age > FILL_SECONDS || cell === undefined) return null
                const [x, y, z] = fillPoint(cellSpot(cell), age / FILL_SECONDS)
                return <ItemCube key={`f${f.jobId}`} x={x} z={z} y={y} item={f.key} />
              })}

            {/* Dropped requests tumble and fade. */}
            {sim.flow.recentDrops.map((d) => {
              const age = ageOf(d.tick)
              if (age > FALL_SECONDS) return null
              const [x, y, z] = dropPoint(d.node, age, d.jobId)
              return (
                <Packet key={`d${d.jobId}`} at={[x, y, z]} fill="var(--danger)" opacity={1 - age / FALL_SECONDS} />
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
  now,
}: {
  sim: CachingSim
  st: CachingState
  rise: number
  ageOf: (tick: number) => number
  now: number
}) {
  // Where each item's cell is drawn. When an item moves (it was just used, so
  // it goes to the most-recent end) it slides there instead of jumping.
  const slides = useRef(new Map<number, { from: V3; to: number; at: number }>())
  const h = CACHE.h * rise
  if (st.cacheDown) return <IsoBox x={CACHE.x} z={0} w={CACHE.w} d={CACHE.d} h={h} dim stroke="var(--muted)" />

  const entries = [...sim.cache.entries.values()]
  const lastHit = new Map<number, number>()
  for (const e of sim.cache.events) if (e.kind === 'hit') lastHit.set(e.key, e.tick)
  const ttlSeconds = st.ttl > 0 ? st.ttl : Infinity

  const spotNow = (key: number, index: number): V3 => {
    const target = cellSpot(index)
    const s = slides.current.get(key)
    if (!s) {
      slides.current.set(key, { from: target, to: index, at: now })
      return target
    }
    const t = Math.min(1, (now - s.at) / SLIDE_MS)
    const k = 1 - Math.pow(1 - t, 3)
    const end = cellSpot(s.to)
    const shown: V3 = [s.from[0] + (end[0] - s.from[0]) * k, end[1], s.from[2] + (end[2] - s.from[2]) * k]
    if (s.to !== index) slides.current.set(key, { from: shown, to: index, at: now })
    return shown
  }
  for (const key of slides.current.keys()) if (!sim.cache.entries.has(key)) slides.current.delete(key)

  const r = { w: 0.08, d: 0.12 }
  const cell = ([x, y, z]: V3, k = 1) =>
    points([
      [x - r.w * k, y, z - r.d * k],
      [x - r.w * k, y, z + r.d * k],
      [x + r.w * k, y, z + r.d * k],
      [x + r.w * k, y, z - r.d * k],
    ])

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
      {/* Memory cells on the lid: one slot per item it can hold. */}
      {rise === 1 &&
        Array.from({ length: st.capacity }, (_, i) => (
          <polygon key={`slot${i}`} points={cell(cellSpot(i))} fill="var(--subtle)" stroke="var(--line)" strokeWidth={0.6} />
        ))}
      {/* What it holds, least recently used first: filled, fading as it ages
          toward its TTL, red once the database has changed it. A cell stays
          empty until its answer has landed, and pulses when it answers a hit.
          Popular items show their letter. */}
      {rise === 1 &&
        entries.map((entry, i) => {
          const spot = spotNow(entry.key, i)
          if (ageOf(entry.storedAt) < FILL_SECONDS) return null
          const fresh = 1 - Math.min(1, ageOf(entry.storedAt) / ttlSeconds) * 0.7
          const hit = lastHit.get(entry.key)
          const pulse = hit === undefined ? 1 : ageOf(hit) / PULSE_SECONDS
          const mark = markOf(entry.key)
          const outdated = (sim.cachedVersion.get(entry.key) ?? 0) < sim.versions[entry.key]
          const [tx, ty] = project(spot)
          return (
            <g key={entry.key}>
              <polygon
                points={cell(spot)}
                fill={outdated ? 'var(--danger)' : 'var(--fg)'}
                fillOpacity={fresh}
                stroke="var(--line)"
                strokeWidth={0.6}
              />
              {pulse < 1 && <polygon points={cell(spot, 1.4 + pulse)} fill="none" stroke="var(--fg)" strokeWidth={1.5} opacity={1 - pulse} />}
              {mark && (
                <text x={tx} y={ty + 0.4} textAnchor="middle" dominantBaseline="middle" className="font-mono" fontSize={6.5} fontWeight={700} fill="var(--bg)">
                  {mark}
                </text>
              )}
            </g>
          )
        })}
    </g>
  )
}

// One bar of the popularity chart: solid while the item is in the cache.
function Bar({ x, z, h, item, cached }: { x: number; z: number; h: number; item: number; cached: boolean }) {
  const mark = markOf(item)
  const [tx, ty] = project([x, h, z])
  return (
    <g>
      <IsoBox x={x} z={z} w={BARS.size} d={BARS.size} h={h} fill={cached ? 'var(--fg)' : 'var(--iso-idle)'} />
      {mark && (
        <text x={tx} y={ty - 6} textAnchor="middle" className="font-mono" fontSize={8} fontWeight={700} fill="var(--fg)">
          {mark}
        </text>
      )}
    </g>
  )
}

// A request in flight. The most popular items are bigger and carry their
// letter on top, so the same item can be followed through the system.
function ItemCube({ x, y, z, item, fill = 'var(--fg)', opacity }: { x: number; y: number; z: number; item?: number; fill?: string; opacity?: number }) {
  const mark = markOf(item)
  const at: V3 = [x, y + (mark ? MARKED_CUBE : CUBE) / 2, z]
  if (!mark) return <Packet at={at} fill={fill} opacity={opacity} />
  const [tx, ty] = project(at)
  return (
    <g opacity={opacity}>
      <Packet at={at} fill={fill} scale={1.7} />
      <text x={tx} y={ty + 0.5} textAnchor="middle" dominantBaseline="middle" className="font-mono" fontSize={8} fontWeight={700} fill="var(--bg)" pointerEvents="none">
        {mark}
      </text>
    </g>
  )
}
