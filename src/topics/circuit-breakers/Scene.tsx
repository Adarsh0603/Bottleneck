import { useRef, type ReactNode } from 'react'
import { BreakerPiece, Piece } from '../../core/build/pieces'
import { HALF } from '../../core/build/types'
import { depth } from '../../core/iso/geometry'
import { FloorPath, IsoBox, Packet, Tag } from '../../core/iso/primitives'
import { crowd, edge, glide } from '../../core/iso/crowd'
import Viewport from '../../core/iso/Viewport'
import type { SceneProps, V3 } from '../../core/types'
import type { ShopSim } from './engine'
import { DEP_NAMES, MODE_NAMES, TICKS_PER_SECOND, type Dep } from './shop'
import type { Beat, ShopState } from './types'
import { above, DEP_AT, entryOf, exitOf, GATE_AT, MS_PER_TICK, spotOf, type Spot } from './world'

const FLY_Y = 0.55
const FALL_SECONDS = 1.2
const THREAD = 0.2
const THREAD_GAP = 0.27
const PER_ROW = 8

// The point `p` of the way along a route.
const along = (pts: V3[], p: number): V3 => {
  const legs = pts.slice(1).map((q, i) => Math.hypot(q[0] - pts[i][0], q[2] - pts[i][2]))
  let left = p * legs.reduce((a, b) => a + b, 0)
  for (let i = 0; i < legs.length; i++) {
    if (left <= legs[i] || i === legs.length - 1) {
      const k = legs[i] === 0 ? 1 : Math.min(1, left / legs[i])
      return [pts[i][0] + (pts[i + 1][0] - pts[i][0]) * k, 0, pts[i][2] + (pts[i + 1][2] - pts[i][2]) * k]
    }
    left -= legs[i]
  }
  return pts[pts.length - 1]
}

export default function Scene({ simRef, lastTickAt, st, beat, shot, shake, quiet, markers }: SceneProps<ShopState, ShopSim, Beat>) {
  const born = useRef(new Map<string, number>())
  const sim = simRef.current
  if (!sim) return null

  const tags = new Set(beat.tags ?? [])
  const deps: Dep[] = st.reviews || tags.has('rev') ? ['pay', 'rev'] : ['pay']
  const keys = ['users', 'shop', ...deps]
  const bounds = keys.map((key) => spotOf(key)).filter((s): s is Spot => !!s).map((s) => above(s, 1.5))

  return (
    <Viewport
      target={shot.target}
      bounds={bounds}
      zoom={shot.zoom}
      shake={shake}
      panKey={shot}
      label="Isometric view of users calling a shop, which calls a payments service."
      markers={markers}
    >
      {({ now }) => {
        const s = sim.shop
        const flow = s.flow
        const m = sim.metrics
        const frac = Math.min(1, Math.max(0, (now - lastTickAt.current) / MS_PER_TICK))
        const c = crowd(flow.inTransit.length)
        const spot = (key: string) => spotOf(key)!
        const users = spot('users')
        const shop = spot('shop')

        const riseOf = (key: string) => {
          if (!born.current.has(key)) born.current.set(key, now)
          const t = Math.min(1, (now - born.current.get(key)!) / 800)
          return 1 - Math.pow(1 - t, 3)
        }
        const live = new Set(st.breaker ? deps.map((d) => `gate-${d}`) : [])
        for (const key of born.current.keys()) if (!live.has(key)) born.current.delete(key)

        const routes: V3[][] = [[exitOf(users), entryOf(shop)]]
        for (const dep of deps) routes.push([exitOf(shop), entryOf(spot(dep))])

        const solids: { d: number; node: ReactNode }[] = []
        solids.push({ d: depth(users.x, users.z), node: <Piece key="users" kind="users" x={users.x} z={users.z} active={7} /> })
        solids.push({ d: depth(shop.x, shop.z), node: <Piece key="shop" kind="app" x={shop.x} z={shop.z} node={s.shop} /> })

        // The thread pool: one cell for each thread. Busy threads are dark,
        // and a thread stuck waiting on a call for over a second turns red.
        const busy = m.threadsBusy
        for (let i = 0; i < st.threads; i++) {
          const x = shop.x - 0.95 + (i % PER_ROW) * THREAD_GAP
          const z = shop.z + 1.45 + Math.floor(i / PER_ROW) * THREAD_GAP
          const fill = i < m.stuck ? 'var(--danger)' : i < busy ? 'var(--fg)' : undefined
          solids.push({ d: depth(x, z), node: <IsoBox key={`t${i}`} x={x} z={z} w={THREAD} d={THREAD} h={0.12} fill={fill} /> })
        }

        // Requests waiting for a thread.
        s.shop.queue.slice(0, 6).forEach((job, k) => {
          const qx = shop.x - HALF.app - 0.3 - k * 0.28
          solids.push({ d: depth(qx, shop.z), node: <Packet key={`q${job.id}`} at={[qx, 0.12, shop.z]} fill="var(--danger)" /> })
        })

        for (const dep of deps) {
          const at = DEP_AT[dep]
          solids.push({ d: depth(at.x, at.z), node: <Piece key={dep} kind="app" x={at.x} z={at.z} node={s.deps[dep]} /> })
          if (st.breaker) {
            const g = GATE_AT[dep]
            solids.push({
              d: depth(g.x, g.z),
              node: <BreakerPiece key={`gate-${dep}`} x={g.x} z={g.z} rise={riseOf(`gate-${dep}`)} state={m.breaker[dep]} />,
            })
          }
        }
        solids.sort((a, b) => a.d - b.d)

        const labels: ReactNode[] = []
        if (tags.has('users')) labels.push(<Tag key="users" at={above(users, 1.6)} label="Customers" />)
        if (tags.has('shop') || tags.has('threads')) {
          const full = m.threadsBusy >= st.threads
          labels.push(<Tag key="shop" at={above(shop, 1.9)} label={`Shop · ${m.threadsBusy} / ${st.threads} threads busy`} danger={full} />)
        }
        for (const dep of deps) {
          if (!tags.has(dep)) continue
          const mode = dep === 'pay' ? st.pay : st.rev
          labels.push(<Tag key={dep} at={above(spot(dep), 1.9)} label={`${DEP_NAMES[dep]} · ${MODE_NAMES[mode].toLowerCase()}`} danger={mode !== 'ok'} />)
        }
        if (tags.has('breaker') && st.breaker) {
          for (const dep of deps) {
            const g = GATE_AT[dep]
            const state = m.breaker[dep]
            labels.push(
              <Tag
                key={`gate-${dep}`}
                at={[g.x, 1.4, g.z]}
                label={state === 'closed' ? 'Breaker · closed' : state === 'open' ? 'Breaker · open' : 'Breaker · testing'}
                danger={state === 'open'}
              />,
            )
          }
        }

        return (
          <>
            {routes.map((route, i) => (
              <FloorPath key={i} route={route} />
            ))}
            {solids.map((x) => x.node)}

            {/* Requests on their way. */}
            {flow.inTransit.map((t) => {
              const a = spotOf(t.from)
              const b = spotOf(t.to)
              if (!a || !b) return null
              const route = [exitOf(a), entryOf(b)]
              const p = glide(Math.min(1, t.progress + frac / t.ticks))
              const [x, , z] = along(route, p)
              return <Packet key={`${t.job.id}:${t.to}`} at={[x, FLY_Y + Math.sin(p * Math.PI) * 0.3, z]} scale={c.scale} fill="var(--fg)" opacity={c.opacity * edge(p)} />
            })}

            {/* Requests that failed tumble in front of the shop. */}
            {flow.recentDrops.map((d) => {
              const at = spotOf(d.node)
              if (!at) return null
              const age = (sim.tick - d.tick + frac) / TICKS_PER_SECOND
              if (age > FALL_SECONDS) return null
              const side = d.jobId % 2 === 0 ? 1 : -1
              return (
                <Packet key={`d${d.jobId}`} at={[at.x - HALF[at.kind] - 0.4 - age * 0.6, FLY_Y + age * 1.2 - 5 * age * age, at.z + side * (0.15 + age * 0.8)]} fill="var(--danger)" opacity={1 - age / FALL_SECONDS} />
              )
            })}

            {!quiet && labels}
          </>
        )
      }}
    </Viewport>
  )
}
