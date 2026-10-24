import type { ReactNode } from 'react'
import { depth } from '../../core/iso/geometry'
import { Crowd, FloorPath, IsoBox, IsoCylinder, Tag } from '../../core/iso/primitives'
import Viewport from '../../core/iso/Viewport'
import type { SceneProps, V3 } from '../../core/types'
import type { CapSim } from './engine'
import type { Beat, CapState } from './types'
import { above, DB, dbSpot, HOT, MS_PER_TICK, other, REGION_NAMES, REGIONS, spotOf, TICKS_PER_SECOND, USERS_X, usersSpot, type Region } from './world'

const CUBE = 0.22
const FLY_Y = 0.55
const SHIP_Y = 2.2 // changes arc high between the regions
const STALE_SECONDS = 0.9
const FALL_SECONDS = 1.2
const SLOT = 0.28

export default function Scene({ simRef, lastTickAt, st, beat, shot, shake, quiet, markers }: SceneProps<CapState, CapSim, Beat>) {
  const sim = simRef.current
  if (!sim) return null

  return (
    <Viewport
      target={shot.target}
      zoom={shot.zoom}
      shake={shake}
      panKey={shot}
      label="Isometric view of two regions, each with its users and a database, joined by a link."
      markers={markers}
    >
      {({ now }) => {
        const flow = sim.flow
        const frac = Math.min(1, Math.max(0, (now - lastTickAt.current) / MS_PER_TICK))
        const ageOf = (tick: number) => (sim.tick - tick + frac) / TICKS_PER_SECOND
        const m = sim.metrics
        const tags = new Set(beat.tags ?? [])
        const hotNow = (r: Region) => m.load[r] > HOT || sim.dbs[r].queue.length >= sim.dbs[r].queueLimit * 0.75

        const routes: V3[][] = REGIONS.map((r) => {
          const u = usersSpot(r)
          const d = dbSpot(r)
          return [
            [u.x + 1.1, 0, u.z],
            [d.x - DB.r, 0, d.z],
          ]
        })

        // The link between the databases: broken in the middle while cut.
        const w = dbSpot('west')
        const e = dbSpot('east')
        const linkRoutes: V3[][] = st.partitioned
          ? [
              [[w.x, 0, w.z + DB.r], [w.x, 0, (w.z + e.z) / 2 - 1.1]],
              [[e.x, 0, e.z - DB.r], [e.x, 0, (w.z + e.z) / 2 + 1.1]],
            ]
          : [[[w.x, 0, w.z + DB.r], [e.x, 0, e.z - DB.r]]]

        const solids: { d: number; node: ReactNode }[] = []
        for (const r of REGIONS) {
          const u = usersSpot(r)
          const s = dbSpot(r)
          solids.push({ d: depth(u.x, u.z), node: <Crowd key={`u-${r}`} x={u.x} z={u.z} active={Math.round(st.rps)} /> })
          solids.push({ d: depth(s.x, s.z), node: <Database key={r} x={s.x} z={s.z} busy={sim.dbs[r].active.length} hot={hotNow(r)} /> })
        }
        solids.sort((a, b) => a.d - b.d)

        const labels: ReactNode[] = []
        if (tags.has('users')) for (const r of REGIONS) labels.push(<Tag key={`u-${r}`} at={[USERS_X, 1, usersSpot(r).z]} label={`${REGION_NAMES[r]} users`} />)
        if (tags.has('dbs')) {
          for (const r of REGIONS) {
            const refusing = sim.refuses(r)
            labels.push(<Tag key={r} at={above(r, 0.7)} label={refusing ? `${REGION_NAMES[r]} · refusing` : `${REGION_NAMES[r]} database`} danger={refusing || hotNow(r)} />)
          }
        }
        if (tags.has('link')) {
          labels.push(<Tag key="link" at={[w.x, 0.6, (w.z + e.z) / 2]} label={st.partitioned ? 'Link cut' : 'Link'} danger={st.partitioned} />)
        }
        if (tags.has('stale')) {
          for (const r of REGIONS) {
            if (sim.staleEvents.some((ev) => ev.node === r && ageOf(ev.tick) < STALE_SECONDS)) {
              labels.push(<Tag key={`stale-${r}`} at={above(r, 1.5)} label="Stale" danger />)
            }
          }
        }
        if (tags.has('conflict') && m.conflicts > 0) {
          labels.push(<Tag key="conflict" at={[w.x, SHIP_Y, (w.z + e.z) / 2]} label={`${m.conflicts} conflict${m.conflicts === 1 ? '' : 's'}`} danger={st.partitioned} />)
        }

        return (
          <>
            {routes.map((route, i) => (
              <FloorPath key={`r${i}`} route={route} />
            ))}
            {linkRoutes.map((route, i) => (
              <FloorPath key={`l${i}`} route={route} />
            ))}
            {solids.map((s) => s.node)}

            {/* Requests on their way. */}
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

            {/* Writes shipping to the other region, arcing over the link. */}
            {sim.shipping.map((s, i) => {
              const from = dbSpot(other(s.to))
              const to = dbSpot(s.to)
              const p = Math.min(1, (sim.tick - s.sentAt + frac) / (s.arrive - s.sentAt))
              return (
                <IsoBox
                  key={`s${i}-${s.sentAt}-${s.to}`}
                  x={from.x + (to.x - from.x) * p}
                  z={from.z + (to.z - from.z) * p}
                  y={DB.h + Math.sin(p * Math.PI) * (SHIP_Y - DB.h)}
                  w={0.16}
                  d={0.16}
                  h={0.16}
                />
              )
            })}

            {/* A stale answer: a red cube pops up from the region that gave it. */}
            {sim.staleEvents.map((ev, i) => {
              const age = ageOf(ev.tick)
              if (age > STALE_SECONDS) return null
              const s = dbSpot(ev.node)
              return (
                <IsoBox
                  key={`st${i}-${ev.tick}`}
                  x={s.x}
                  z={s.z}
                  y={DB.h + 0.4 + age * 1.2}
                  w={CUBE}
                  d={CUBE}
                  h={CUBE}
                  fill="var(--danger)"
                  opacity={1 - age / STALE_SECONDS}
                />
              )
            })}

            {/* Turned-away requests tumble in front of the region that refused them. */}
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

// A database: a cylinder with its worker slots on the lid, lit while busy.
function Database({ x, z, busy, hot }: { x: number; z: number; busy: number; hot: boolean }) {
  const d = DB.r * 0.32
  const slots = [
    [-d, -d],
    [d, -d],
    [-d, d],
    [d, d],
  ].sort((a, b) => depth(a[0], a[1]) - depth(b[0], b[1]))
  return (
    <g>
      <IsoCylinder x={x} z={z} r={DB.r} h={DB.h} stroke={hot ? 'var(--danger)' : 'var(--fg)'} />
      {slots.map(([dx, dz], i) => (
        <IsoBox key={i} x={x + dx} z={z + dz} y={DB.h} w={SLOT} d={SLOT} h={SLOT} fill={i < busy ? 'var(--fg)' : undefined} />
      ))}
    </g>
  )
}
