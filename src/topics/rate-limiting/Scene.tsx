import { useRef, type ReactNode } from 'react'
import { Piece } from '../../core/build/pieces'
import { HALF } from '../../core/build/types'
import { depth } from '../../core/iso/geometry'
import { FloorPath, IsoBox, Tag } from '../../core/iso/primitives'
import { crowd } from '../../core/iso/crowd'
import Viewport from '../../core/iso/Viewport'
import type { SceneProps, V3 } from '../../core/types'
import type { RateSim } from './engine'
import { ALGO_NAMES, CLIENTS, CLIENT_NAMES, TICKS_PER_SECOND } from './gate'
import type { Beat, RateState } from './types'
import { above, BALANCER, entryOf, exitOf, gateZ, MS_PER_TICK, spotOf, type Spot } from './world'

const CUBE = 0.22
const FLY_Y = 0.55
const FALL_SECONDS = 1.2
const RISE_MS = 800
const WAIT_GAP = 0.28

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

export default function Scene({ simRef, lastTickAt, st, beat, shot, shake, quiet, markers }: SceneProps<RateState, RateSim, Beat>) {
  const born = useRef(new Map<string, number>())
  const sim = simRef.current
  if (!sim) return null

  // Everything on the floor right now, so the camera can frame all of it.
  const onFloor = ['api', ...CLIENTS]
  if (st.gateways > 1) onFloor.push('lb')
  if (st.shared && st.gateways > 1 && beat.tags?.includes('counter')) onFloor.push('counter')
  for (let i = 0; i < (st.limiting ? st.gateways : 0); i++) onFloor.push(`gate-${i}`)
  const bounds = onFloor.map((key) => spotOf(key, st.gateways)).filter((s): s is Spot => !!s).map((s) => above(s, 1.5))

  return (
    <Viewport
      target={shot.target}
      bounds={bounds}
      zoom={shot.zoom}
      shake={shake}
      panKey={shot}
      label="Isometric view of three clients sending requests through a rate limiter to an API."
      markers={markers}
    >
      {({ now }) => {
        const g = sim.gateway
        const flow = g.flow
        const frac = Math.min(1, Math.max(0, (now - lastTickAt.current) / MS_PER_TICK))
        const c = crowd(flow.inTransit.length)
        const tags = new Set(beat.tags ?? [])
        const n = st.gateways
        const gates = g.active
        const many = n > 1
        const spot = (key: string) => spotOf(key, n)
        const m = sim.metrics

        const riseOf = (key: string) => {
          if (!born.current.has(key)) born.current.set(key, now)
          const t = Math.min(1, (now - born.current.get(key)!) / RISE_MS)
          return 1 - Math.pow(1 - t, 3)
        }
        const live = new Set([...(st.limiting ? gates : []).map((x) => x.key), many ? 'lb' : '', st.shared && many ? 'counter' : ''])
        for (const key of born.current.keys()) if (!live.has(key)) born.current.delete(key)

        // The way a request takes between two nodes. With several gateways it
        // passes through the balancer on the way.
        const path = (from: string, to: string): V3[] | undefined => {
          const a = spot(from)
          const b = spot(to)
          if (!a || !b) return undefined
          const viaBalancer = many && (CLIENTS as readonly string[]).includes(from)
          if (!viaBalancer) return [exitOf(a), entryOf(b)]
          const lb = spot('lb') as Spot
          return [exitOf(a), entryOf(lb), exitOf(lb), entryOf(b)]
        }

        const routes: V3[][] = []
        // Until a limiter is added, requests go straight to the API.
        if (!st.limiting) for (const c of CLIENTS) routes.push([exitOf(spot(c)!), entryOf(spot('api')!)])
        else
        for (const c of CLIENTS) {
          if (many) routes.push([exitOf(spot(c)!), entryOf(spot('lb')!)])
          else routes.push(path(c, gates[0].key)!)
        }
        for (const gate of st.limiting ? gates : []) {
          if (many) routes.push([exitOf(spot('lb')!), entryOf(spot(gate.key)!)])
          routes.push(path(gate.key, 'api')!)
        }
        if (many && st.shared && tags.has('counter')) {
          const c = spot('counter')!
          for (const gate of gates) routes.push([exitOf(spot(gate.key)!), [c.x - 0.6, 0, c.z]])
        }

        const solids: { d: number; node: ReactNode }[] = []
        for (const c of CLIENTS) {
          const s = spot(c)!
          const loud = c === 'bot' && st.bot !== 'quiet'
          solids.push({ d: depth(s.x, s.z), node: <Piece key={c} kind="users" x={s.x} z={s.z} active={loud ? 9 : c === 'ann' && st.annBursts ? 3 : 2} /> })
        }
        if (many) solids.push({ d: depth(BALANCER.x, BALANCER.z), node: <Piece key="lb" kind="balancer" x={BALANCER.x} z={BALANCER.z} rise={riseOf('lb')} /> })
        if (many && st.shared && tags.has('counter')) {
          const c = spot('counter')!
          solids.push({ d: depth(c.x, c.z), node: <Piece key="counter" kind="cache" x={c.x} z={c.z} rise={riseOf('counter')} /> })
        }
        for (const gate of st.limiting ? gates : []) {
          const s = spot(gate.key)!
          solids.push({ d: depth(s.x, s.z), node: <Piece key={gate.key} kind="limiter" x={s.x} z={s.z} rise={riseOf(gate.key)} /> })
          // Requests held back in a leaky bucket, waiting to drip out.
          gate
            .held()
            .slice(0, 8)
            .forEach((job, k) => {
              const qx = s.x - HALF.limiter - 0.3 - k * WAIT_GAP
              solids.push({ d: depth(qx, s.z), node: <IsoBox key={`h${job.id}`} x={qx} z={s.z} w={CUBE} d={CUBE} h={CUBE} fill="var(--fg)" /> })
            })
        }
        const api = spot('api')!
        solids.push({ d: depth(api.x, api.z), node: <Piece key="api" kind="app" x={api.x} z={api.z} node={g.api} /> })
        g.api.queue.slice(0, 8).forEach((job, k) => {
          const qx = api.x - HALF.app - 0.3 - k * WAIT_GAP
          solids.push({ d: depth(qx, api.z), node: <IsoBox key={`q${job.id}`} x={qx} z={api.z} w={CUBE} d={CUBE} h={CUBE} fill="var(--fg)" /> })
        })
        solids.sort((a, b) => a.d - b.d)

        const labels: ReactNode[] = []
        if (tags.has('clients')) {
          for (const c of CLIENTS) {
            const turned = m.rejected[c]
            const label = turned > 0 ? `${CLIENT_NAMES[c]} · ${turned} turned away` : CLIENT_NAMES[c]
            labels.push(<Tag key={c} at={above(spot(c)!, 1.6)} label={label} danger={c !== 'bot' && turned > 0} />)
          }
        }
        if (tags.has('limiter')) {
          const label = !st.limiting
            ? 'No limit'
            : `${tags.has('named') ? `Algorithm: ${ALGO_NAMES[st.algo]} · ` : 'Limit · '}${st.limit} / second${st.algo === 'token' || st.algo === 'leaky' ? ` · bucket of ${st.burst}` : ''}`
          labels.push(<Tag key="limiter" at={above(spot(gates[0].key)!, 1.5)} label={many ? `${label} · each` : label} danger={!st.limiting} />)
        }
        if (tags.has('api')) {
          labels.push(<Tag key="api" at={above(api, 1.9)} label={`API · 10 / second${m.overload > 0 ? ` · ${m.overload} dropped` : ''}`} danger={g.recentOverload > 0} />)
        }
        if (tags.has('counter') && many) {
          labels.push(
            st.shared ? (
              <Tag key="counter" at={above(spot('counter')!, 1.1)} label="One shared counter" />
            ) : (
              <Tag key="counter" at={[-1.8, 0.3, gateZ(2, 3) + 1.6]} label="Each gateway counts alone" danger />
            ),
          )
        }

        return (
          <>
            {routes.map((route, i) => (
              <FloorPath key={i} route={route} />
            ))}
            {solids.map((s) => s.node)}

            {/* Requests on their way. */}
            {flow.inTransit.map((t) => {
              let route = path(t.from, t.to)
              if (!route) return null
              let p = Math.min(1, t.progress + frac / t.ticks)
              // With no limiter the gateway is invisible: fly straight from the
              // client to the API, treating the gateway as a point on that line.
              const client = t.job.from && spot(t.job.from)
              if (!st.limiting && client) {
                const a = exitOf(client)
                const b = entryOf(api)
                const gx = spot(/^gate-/.test(t.to) ? t.to : t.from)!.x
                const f = Math.min(1, Math.max(0, (gx - a[0]) / (b[0] - a[0])))
                p = /^gate-/.test(t.to) ? p * f : f + (1 - f) * p
                route = [a, b]
              }
              const [x, , z] = along(route, p)
              return <IsoBox key={t.job.id} x={x} z={z} y={FLY_Y + Math.sin(p * Math.PI) * 0.3} w={CUBE * c.scale} d={CUBE * c.scale} h={CUBE * c.scale} fill="var(--fg)" opacity={c.opacity} />
            })}

            {/* Requests turned away tumble where they were stopped. */}
            {flow.recentDrops.map((d) => {
              const s = spot(d.node)
              if (!s) return null
              const age = (sim.tick - d.tick + frac) / TICKS_PER_SECOND
              if (age > FALL_SECONDS) return null
              const side = d.jobId % 2 === 0 ? 1 : -1
              const x0 = s.x - HALF[s.kind] - 0.6
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
