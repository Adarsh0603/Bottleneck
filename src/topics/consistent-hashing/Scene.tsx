import { useRef, type ReactNode } from 'react'
import { depth, points as polyline } from '../../core/iso/geometry'
import { Crowd, FloorPath, IsoBox, IsoCylinder, Packet, Tag } from '../../core/iso/primitives'
import { crowd, edge, glide } from '../../core/iso/crowd'
import Viewport from '../../core/iso/Viewport'
import type { SceneProps, V3 } from '../../core/types'
import type { ConsistentSim } from './engine'
import { clock, keySpot, KEY_COUNT, nextPoint, ownedRange, pointSpot, ringPoints } from './ring'
import type { Beat, ConsistentState } from './types'
import { APP, DB, HOT, MS_PER_TICK, NODE, nodeIndex, nodeKey, nodeSpot, onRing, RING, TICKS_PER_SECOND, USERS } from './world'

const FLY_Y = 0.55
const FALL_SECONDS = 1.2
const RISE_MS = 800
const SLIDE = 0.15 // how far servers slide toward their new spot each frame
const SLOT = 0.28
const CELL = 0.1
const CELL_GAP = 0.15
const CELL_COLS = 6
const ARC_STEPS = 24

// Each server's colour, to tell its virtual nodes apart.
const serverColor = (i: number) => `var(--srv-${i + 1})`

// A stretch of the ring from one spot to another, going clockwise.
function arc(from: number, to: number): V3[] {
  const span = to >= from ? to - from : to + 1 - from
  return Array.from({ length: ARC_STEPS + 1 }, (_, i) => {
    const p = onRing(from + (span * i) / ARC_STEPS, RING.r - 0.5)
    return [p.x, 0.02, p.z] as V3
  })
}

export default function Scene({ simRef, lastTickAt, st, beat, shot, shake, quiet, markers }: SceneProps<ConsistentState, ConsistentSim, Beat>) {
  const born = useRef(new Map<string, number>())
  const shown = useRef(new Map<string, { x: number; z: number }>())
  const sim = simRef.current
  if (!sim) return null

  return (
    <Viewport
      target={shot.target}
      zoom={shot.zoom}
      shake={shake}
      panKey={shot}
      label="Isometric view of an app, a ring of cache servers and a database."
      markers={markers}
    >
      {({ now }) => {
        const flow = sim.flow
        const frac = Math.min(1, Math.max(0, (now - lastTickAt.current) / MS_PER_TICK))
        const c = crowd(flow.inTransit.length)
        const ageOf = (tick: number) => (sim.tick - tick + frac) / TICKS_PER_SECOND
        const m = sim.metrics
        const tags = new Set(beat.tags ?? [])
        const n = sim.nodes
        const ring = sim.ring
        const riseOf = (key: string) => {
          if (!born.current.has(key)) born.current.set(key, now)
          const t = Math.min(1, (now - born.current.get(key)!) / RISE_MS)
          return 1 - Math.pow(1 - t, 3)
        }

        // Servers move as the count or the mode changes; slide them there.
        const keys = Array.from({ length: n }, (_, i) => nodeKey(i))
        for (const [i, key] of keys.entries()) {
          const target = nodeSpot(i, n, ring)
          const at = shown.current.get(key)
          shown.current.set(key, at ? { x: at.x + (target.x - at.x) * SLIDE, z: at.z + (target.z - at.z) * SLIDE } : target)
        }
        for (const s of sim.servers.slice(n)) {
          born.current.delete(s.key)
          shown.current.delete(s.key)
        }
        const spotOf = (key: string): { x: number; z: number } | undefined => {
          if (key === 'users') return USERS
          if (key === 'app') return APP
          if (key === 'db') return DB
          return shown.current.get(key)
        }
        const hotNow = (i: number) => {
          const w = sim.servers[i]
          if (!w.alive) return false
          return m.load[w.key] > HOT || w.queue.length >= w.queueLimit * 0.75
        }
        const dbHot = m.dbLoad > HOT || sim.db.queue.length >= sim.db.queueLimit * 0.75

        const floor: ReactNode[] = []
        const circle = Array.from({ length: 49 }, (_, i) => {
          const p = onRing(i / 48)
          return [p.x, 0, p.z] as V3
        })
        floor.push(<FloorPath key="ring" route={circle} />)
        floor.push(<FloorPath key="users" route={[[USERS.x + 1.1, 0, USERS.z], [APP.x - APP.w / 2, 0, APP.z]]} />)
        floor.push(<FloorPath key="db" route={[[APP.x + APP.w / 2, 0, APP.z], [DB.x - DB.r, 0, DB.z]]} />)

        // Where each server's spots on the ring are, and the items between them.
        const picked = beat.pick
        if (ring) {
          for (const i of sim.alive) {
            for (let j = 1; j < st.points; j++) {
              const p = onRing(pointSpot(i, j))
              floor.push(<IsoBox key={`p${i}-${j}`} x={p.x} z={p.z} w={0.26} d={0.26} h={0.12} fill={beat.virtual ? serverColor(i) : 'var(--muted)'} />)
            }
          }
        }
        if (ring && beat.items) {
          for (let k = 0; k < KEY_COUNT; k++) {
            const p = onRing(keySpot(k), RING.r - 0.5)
            const isPick = k === picked
            floor.push(<IsoBox key={`k${k}`} x={p.x} z={p.z} w={isPick ? 0.24 : 0.14} d={isPick ? 0.24 : 0.14} h={isPick ? 0.5 : 0.08} fill={isPick ? 'var(--fg)' : undefined} />)
          }
          if (picked !== undefined && sim.alive.length && !quiet) {
            const hit = nextPoint(ringPoints(sim.alive, st.points), picked)
            floor.push(
              <polyline key="clockwise" points={polyline(arc(keySpot(picked), hit.at))} stroke="var(--fg)" strokeWidth={2.5} fill="none" strokeLinecap="round" />,
            )
          }
        }

        // With hash mod N, trace one item's requests from the app to its server.
        const owner = picked === undefined ? -1 : sim.assigner.owner[picked]
        const routeTo = !ring && owner >= 0 && !quiet ? spotOf(nodeKey(owner)) : undefined
        if (routeTo) {
          floor.push(
            <polyline
              key="route"
              points={polyline([[APP.x + APP.w / 2, 0.02, APP.z], [routeTo.x, 0.02, routeTo.z]])}
              stroke="var(--fg)"
              strokeWidth={2.5}
              fill="none"
              strokeLinecap="round"
            />,
          )
        }

        const solids: { d: number; node: ReactNode }[] = [
          { d: depth(USERS.x, USERS.z), node: <Crowd key="users" x={USERS.x} z={USERS.z} active={Math.round(st.rps / 2)} /> },
          { d: depth(APP.x, APP.z), node: <AppBox key="app" /> },
          { d: depth(DB.x, DB.z), node: <Database key="db" busy={sim.db.active.length} hot={dbHot} /> },
        ]
        for (const [i, key] of keys.entries()) {
          const s = spotOf(key)!
          const owned = sim.assigner.owner.flatMap((o, k) => (o === i ? [k] : []))
          solids.push({
            d: depth(s.x, s.z),
            node: (
              <Server
                key={key}
                x={s.x}
                z={s.z}
                busy={sim.servers[i].active.length}
                hot={hotNow(i)}
                down={sim.down === i}
                color={beat.virtual ? serverColor(i) : undefined}
                rise={i === 0 ? 1 : riseOf(key)}
                owned={owned.map((k) => sim.assigner.warm[k])}
              />
            ),
          })
        }
        solids.sort((a, b) => a.d - b.d)

        const labels: ReactNode[] = []
        if (tags.has('users')) labels.push(<Tag key="users" at={[USERS.x, 1, USERS.z]} label="Users" />)
        if (tags.has('app')) labels.push(<Tag key="app" at={[APP.x, APP.h + 0.5, APP.z]} label="App servers" />)
        if (tags.has('db')) labels.push(<Tag key="db" at={[DB.x, DB.h + 0.7, DB.z]} label={tags.has('load') ? `Database · ${Math.round(m.dbLoad * 100)}%` : 'Database'} danger={dbHot} />)
        if (tags.has('servers') || tags.has('load') || tags.has('items')) {
          for (const [i, key] of keys.entries()) {
            const s = spotOf(key)!
            const down = sim.down === i
            const held = sim.assigner.owner.filter((o) => o === i).length
            const range = ring && beat.ring && st.points === 1 ? ownedRange(ringPoints(sim.alive, 1), i) : null
            const label = down
              ? `Server ${i + 1} · Down`
              : tags.has('load')
                ? `Server ${i + 1} · ${Math.round(m.load[key] * 100)}%`
                : tags.has('items')
                  ? `Server ${i + 1} · ${held} items`
                  : range
                    ? `Server ${i + 1} · holds ${range}`
                    : `Server ${i + 1}`
            labels.push(<Tag key={key} at={[s.x, NODE.h + 0.7, s.z]} label={label} danger={down || hotNow(i)} color={beat.virtual ? serverColor(i) : undefined} />)
          }
        }

        const pickTag =
          picked !== undefined && beat.ring ? (
            <Tag key="pick" at={[onRing(keySpot(picked), RING.r - 0.5).x, 0.9, onRing(keySpot(picked), RING.r - 0.5).z]} label={`Item at ${clock(keySpot(picked))}`} />
          ) : null

        const routeTag = routeTo ? (
          <Tag key="route" at={[routeTo.x, NODE.h + 1.5, routeTo.z]} label={`Item ${picked} → Server ${owner + 1}`} />
        ) : null

        return (
          <>
            {floor}
            {solids.map((s) => s.node)}

            {/* Requests on their way. */}
            {flow.inTransit.map((t) => {
              const a = spotOf(t.from)
              const b = spotOf(t.to)
              if (!a || !b) return null
              const p = glide(Math.min(1, t.progress + frac / t.ticks))
              return (
                <Packet key={t.job.id} at={[a.x + (b.x - a.x) * p, FLY_Y + Math.sin(p * Math.PI) * 0.3, a.z + (b.z - a.z) * p]} scale={c.scale} fill="var(--fg)" opacity={c.opacity * edge(p)} />
              )
            })}

            {/* Turned-away requests tumble in front of whoever couldn't take them. */}
            {flow.recentDrops.map((d) => {
              const age = ageOf(d.tick)
              if (age > FALL_SECONDS || nodeIndex(d.node) >= n) return null
              const s = spotOf(d.node)
              if (!s) return null
              const side = d.jobId % 2 === 0 ? 1 : -1
              return (
                <Packet key={`d${d.jobId}`} at={[s.x - 1.1 - age * 0.6, FLY_Y + age * 1.2 - 5 * age * age, s.z + side * (0.15 + age * 0.8)]} fill="var(--danger)" opacity={1 - age / FALL_SECONDS} />
              )
            })}

            {!quiet && labels}
            {pickTag}
            {routeTag}
            {ring && beat.ring
              ? [0, 25, 50, 75].map((n) => {
                  const p = onRing(n / 100, RING.r + 0.9)
                  return <Tag key={`clock${n}`} at={[p.x, 0.2, p.z]} label={String(n)} />
                })
              : null}
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
          points={polyline([
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

// A slot-lidded cylinder, lit while busy.
function Slots({ x, z, y, r, busy }: { x: number; z: number; y: number; r: number; busy: number }) {
  const d = r * 0.32
  const slots = [
    [-d, -d],
    [d, -d],
    [-d, d],
    [d, d],
  ].sort((a, b) => depth(a[0], a[1]) - depth(b[0], b[1]))
  return (
    <>
      {slots.map(([dx, dz], i) => (
        <IsoBox key={i} x={x + dx} z={z + dz} y={y} w={SLOT} d={SLOT} h={SLOT} fill={i < busy ? 'var(--fg)' : undefined} />
      ))}
    </>
  )
}

function Database({ busy, hot }: { busy: number; hot: boolean }) {
  return (
    <g>
      <IsoCylinder x={DB.x} z={DB.z} r={DB.r} h={DB.h} stroke={hot ? 'var(--danger)' : 'var(--fg)'} />
      <Slots x={DB.x} z={DB.z} y={DB.h} r={DB.r} busy={busy} />
    </g>
  )
}

// A cache server: a cylinder whose lid shows every item it holds, as a cell.
// A filled cell is ready to serve; a red one moved here and isn't fetched yet.
function Server({ x, z, busy, hot, down, rise, owned, color }: { x: number; z: number; busy: number; hot: boolean; down: boolean; rise: number; owned: boolean[]; color?: string }) {
  const h = NODE.h * rise
  if (down) return <IsoCylinder x={x} z={z} r={NODE.r} h={h} dim stroke="var(--danger)" />
  const rows = Math.ceil(owned.length / CELL_COLS)
  return (
    <g>
      <IsoCylinder x={x} z={z} r={NODE.r} h={h} stroke={hot ? 'var(--danger)' : (color ?? 'var(--fg)')} bands={[0.5]} />
      {rise === 1 &&
        owned.map((warm, i) => {
          const cx = x + ((i % CELL_COLS) - (CELL_COLS - 1) / 2) * CELL_GAP
          const cz = z + (Math.floor(i / CELL_COLS) - (Math.max(rows, 1) - 1) / 2) * CELL_GAP
          const r = CELL / 2
          return (
            <polygon
              key={i}
              points={polyline([
                [cx - r, h, cz - r],
                [cx - r, h, cz + r],
                [cx + r, h, cz + r],
                [cx + r, h, cz - r],
              ])}
              fill={warm ? 'var(--fg)' : 'var(--danger)'}
            />
          )
        })}
      {rise === 1 && owned.length === 0 && <Slots x={x} z={z} y={h} r={NODE.r} busy={busy} />}
    </g>
  )
}
