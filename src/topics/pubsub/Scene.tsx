import { useRef, type ReactNode } from 'react'
import { Piece } from '../../core/build/pieces'
import { HALF } from '../../core/build/types'
import { depth } from '../../core/iso/geometry'
import { FloorPath, IsoBox, Tag } from '../../core/iso/primitives'
import { crowd, edge, glide } from '../../core/iso/crowd'
import Viewport from '../../core/iso/Viewport'
import type { SceneProps, V3 } from '../../core/types'
import { TEAMS, TEAM_NAMES, TICKS_PER_SECOND, type Team } from './bus'
import type { BusSim } from './engine'
import type { Beat, BusState } from './types'
import { aboveConsumer, CHANNEL, halfOf, MS_PER_TICK, ORDERS, PRODUCT_FILL, spotOf, teamOf } from './world'

const CUBE = 0.22
const FLY_Y = 0.55
const FALL_SECONDS = 1.2
const RISE_MS = 800
const WAIT_GAP = 0.28

const KEY_NAMES = { none: 'no key', order: 'key: order id', product: 'key: product' }

// Events are shaded by product only when the lesson is about products.
const fillOf = (product: number | undefined, tags: Set<string>) => (tags.has('products') ? PRODUCT_FILL[product ?? 0] : 'var(--fg)')

export default function Scene({ simRef, lastTickAt, st, beat, shot, shake, quiet, markers }: SceneProps<BusState, BusSim, Beat>) {
  const born = useRef(new Map<string, number>())
  const sim = simRef.current
  if (!sim) return null

  return (
    <Viewport
      target={shot.target}
      zoom={shot.zoom}
      shake={shake}
      panKey={shot}
      label="Isometric view of an order service, a channel, and three teams that each read the orders."
      markers={markers}
    >
      {({ now }) => {
        const bus = sim.bus
        const flow = bus.flow
        const frac = Math.min(1, Math.max(0, (now - lastTickAt.current) / MS_PER_TICK))
        const c = crowd(flow.inTransit.length)
        const tags = new Set(beat.tags ?? [])
        const present = TEAMS.filter((t) => st[t] > 0)
        const consumers = bus.consumers.filter((c) => c.on && present.includes(c.team))
        const channel = flow.node('channel')

        // New consumers rise into place.
        const riseOf = (key: string) => {
          if (!born.current.has(key)) born.current.set(key, now)
          const t = Math.min(1, (now - born.current.get(key)!) / RISE_MS)
          return 1 - Math.pow(1 - t, 3)
        }
        const live = new Set([...consumers.map((c) => c.key), `channel-${st.mode}`])
        for (const key of born.current.keys()) if (!live.has(key)) born.current.delete(key)

        const exit = (key: string): V3 => {
          const s = spotOf(key)!
          return [s.x + halfOf(key, st.mode), 0, s.z]
        }
        const entry = (key: string): V3 => {
          const s = spotOf(key)!
          return [s.x - halfOf(key, st.mode) - 0.15, 0, s.z]
        }
        const routes: V3[][] = [[exit('orders'), entry('channel')]]
        for (const c of consumers) routes.push([exit('channel'), entry(c.key)])

        const solids: { d: number; node: ReactNode }[] = [
          { d: depth(ORDERS.x, ORDERS.z), node: <Piece key="orders" kind="app" x={ORDERS.x} z={ORDERS.z} /> },
          {
            d: depth(CHANNEL.x, CHANNEL.z),
            node: <Piece key={`channel-${st.mode}`} kind={st.mode} x={CHANNEL.x} z={CHANNEL.z} node={channel} rise={riseOf(`channel-${st.mode}`)} />,
          },
        ]
        for (const c of consumers) {
          const s = spotOf(c.key)!
          solids.push({ d: depth(s.x, s.z), node: <Piece key={c.key} kind="server" x={s.x} z={s.z} node={c} rise={riseOf(c.key)} /> })
          // Events waiting in front of a consumer.
          c.queue.slice(0, 8).forEach((job, k) => {
            const qx = s.x - HALF.server - 0.3 - k * WAIT_GAP
            solids.push({
              d: depth(qx, s.z),
              node: <IsoBox key={`w${job.id}`} x={qx} z={s.z} w={CUBE} d={CUBE} h={CUBE} fill={fillOf(job.key, tags)} />,
            })
          })
        }
        solids.sort((a, b) => a.d - b.d)

        const teamTag = (team: Team) => {
          const mine = consumers.filter((c) => c.team === team)
          const down = mine.length > 0 && mine.every((c) => !c.alive)
          const behind = bus.behind(team)
          let label = TEAM_NAMES[team]
          if (mine.length > 1) label += ` ×${mine.length}`
          if (down) label += ' · offline'
          if (tags.has('behind')) label += ` · ${behind} behind`
          if (tags.has('offsets') && st.mode === 'stream') {
            const r = bus.readers[team]
            const read = r.cursor.reduce((a, b) => a + b, 0)
            const end = Array.from({ length: bus.log.partitions }, (_, p) => bus.log.end(p)).reduce((a, b) => a + b, 0)
            label += ` · read ${read} of ${end}`
          }
          return { label, danger: bus.tally.lost[team] > 0 || down || behind >= 8 }
        }

        const labels: ReactNode[] = []
        if (tags.has('orders')) labels.push(<Tag key="orders" at={[ORDERS.x, 1.8, ORDERS.z]} label="Order service" />)
        if (tags.has('channel')) {
          const waiting = bus.channel?.jobs.length ?? 0
          const label =
            st.mode === 'queue'
              ? `Queue · ${waiting} waiting`
              : st.mode === 'topic'
                ? 'Topic'
                : `Stream · ${st.partitions} partition${st.partitions === 1 ? '' : 's'}${st.key === 'none' ? '' : ` · ${KEY_NAMES[st.key]}`}`
          labels.push(<Tag key="channel" at={[CHANNEL.x, 1.5, CHANNEL.z]} label={label} danger={st.mode === 'queue' && waiting >= 40} />)
        }
        for (const team of present) {
          if (!tags.has(team)) continue
          const { label, danger } = teamTag(team)
          const first = consumers.find((c) => c.team === team)
          labels.push(<Tag key={team} at={aboveConsumer(team, first?.index ?? 0)} label={label} danger={danger} />)
        }

        return (
          <>
            {routes.map((route, i) => (
              <FloorPath key={i} route={route} />
            ))}
            {solids.map((s) => s.node)}

            {/* Events on their way: copies fly to every team at once. */}
            {flow.inTransit.map((t) => {
              const a = spotOf(t.from)
              const b = spotOf(t.to)
              if (!a || !b) return null
              const p = glide(Math.min(1, t.progress + frac / t.ticks))
              const ax = a.x + halfOf(t.from, st.mode)
              const bx = b.x - halfOf(t.to, st.mode) - 0.15
              return (
                <IsoBox
                  key={t.job.id}
                  x={ax + (bx - ax) * p}
                  z={a.z + (b.z - a.z) * p}
                  y={FLY_Y + Math.sin(p * Math.PI) * 0.3}
                  w={CUBE * c.scale}
                  d={CUBE * c.scale}
                  h={CUBE * c.scale}
                  fill={fillOf(t.job.key, tags)}
                  opacity={c.opacity * edge(p)}
                />
              )
            })}

            {/* Events a team missed tumble where they should have arrived. */}
            {flow.recentDrops.map((d) => {
              const age = (sim.tick - d.tick + frac) / TICKS_PER_SECOND
              if (age > FALL_SECONDS) return null
              const s = spotOf(d.node)
              if (!s) return null
              const side = d.jobId % 2 === 0 ? 1 : -1
              const x0 = teamOf(d.node) ? s.x - HALF.server - 0.6 : s.x + halfOf(d.node, st.mode)
              return (
                <IsoBox
                  key={`d${d.jobId}`}
                  x={x0 - age * 0.6}
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
