import type { ReactNode } from 'react'
import { depth, points, project } from '../../core/iso/geometry'
import { IsoBox, Tag } from '../../core/iso/primitives'
import Viewport from '../../core/iso/Viewport'
import type { SceneProps, V3 } from '../../core/types'
import type { GeoSim, Leaf, Rect } from './engine'
import type { Beat, GeoState } from './types'
import { at, FLOOR, MAP, MS_PER_TICK } from './world'

const MAX_CARS = 300 // more cars than this are drawn one in every few
const FADE_TICKS = 6
const RIDER_TOP = 18 // height of the rider icon, in pixels
const CAR_TOP = 9 // height of a car icon, in pixels

// Cars that were looked at are blue, the one picked is green (red when it is
// not the nearest), and the rider is orange.
const CHECKED_COLOR = 'var(--srv-1)'
const CAR_COLOR = 'var(--srv-3)'
const RIDER_COLOR = 'var(--srv-2)'

const BOUNDS: V3[] = [
  [-MAP / 2 - 0.2, 0, -MAP / 2 - 0.2],
  [MAP / 2 + 0.2, 2.4, MAP / 2 + 0.2],
]

const corner = (u: number, v: number) => project(at(u, v, FLOOR)).join(',')

const rectPath = (r: Rect) => `M${corner(r.x0, r.y0)} L${corner(r.x1, r.y0)} L${corner(r.x1, r.y1)} L${corner(r.x0, r.y1)} Z`

// The outline of every quadtree box, as one path, worked out once per tree.
const treePaths = new WeakMap<Leaf[], string>()
const outlineOf = (leaves: Leaf[]) => {
  let d = treePaths.get(leaves)
  if (d === undefined) {
    d = leaves.map((l) => rectPath(l.rect)).join(' ')
    treePaths.set(leaves, d)
  }
  return d
}

// The lines of a grid with `res` cells along a side, as one path.
const gridPath = (res: number) => {
  let d = ''
  for (let k = 1; k < res; k++) d += `M${corner(k / res, 0)} L${corner(k / res, 1)} M${corner(0, k / res)} L${corner(1, k / res)} `
  return d
}

// A small car icon, side view, flat to the screen: body, cabin and two wheels.
// Many are drawn as one path, so they stay cheap.
const carPath = (sx: number, sy: number) =>
  `M${sx - 7},${sy - 2} L${sx - 7},${sy - 6} L${sx - 3.5},${sy - 6} L${sx - 2},${sy - 9} L${sx + 2.5},${sy - 9} L${sx + 4},${sy - 6} L${sx + 7},${sy - 6} L${sx + 7},${sy - 2} Z ` +
  `M${sx - 4.5},${sy - 2} a1.8,1.8 0 1,0 0.01,0 Z M${sx + 3},${sy - 2} a1.8,1.8 0 1,0 0.01,0 Z`

const miniCar = (u: number, v: number) => carPath(...project(at(u, v, FLOOR)))

export default function Scene({ simRef, lastTickAt, st, beat, shot, shake, quiet, markers }: SceneProps<GeoState, GeoSim, Beat>) {
  const sim = simRef.current
  if (!sim) return null

  return (
    <Viewport
      target={shot.target}
      zoom={shot.zoom}
      shake={shake}
      panKey={shot}
      label="Isometric view of a map seen from above, with small cars and a rider standing on it."
      markers={markers}
      bounds={BOUNDS}
    >
      {({ now }) => {
        const frac = Math.min(1, Math.max(0, (now - lastTickAt.current) / MS_PER_TICK))
        const tags = new Set(beat.tags ?? [])
        const last = sim.last
        const ramp = last ? Math.min(1, (sim.tick - last.tick + frac) / FADE_TICKS) : 1

        const step = Math.max(1, Math.ceil(sim.xs.length / MAX_CARS))
        let still = ''
        let lit = ''
        for (let i = 0; i < sim.xs.length; i += step) {
          if (last?.checked.has(i)) lit += miniCar(sim.xs[i], sim.ys[i])
          else still += miniCar(sim.xs[i], sim.ys[i])
        }

        const labels: ReactNode[] = []
        const solids: { d: number; node: ReactNode }[] = []
        if (last) {
          const [rx, , rz] = at(last.rider.x, last.rider.y)
          solids.push({ d: depth(rx, rz), node: <Rider key="rider" x={rx} z={rz} /> })
          // Each label has its own lift, so labels of things close together do not cover one another.
          // Every label's line starts at the top of its icon, so it points to what it names.
          const bad = tags.has('result') && (last.outcome === 'wrong' || last.outcome === 'none')
          if (tags.has('rider') || tags.has('cell')) {
            const named = tags.has('cell') && last.cell
            labels.push(<Label key="rider" x={rx} z={rz} top={RIDER_TOP} lift={bad ? 68 : 22} label={named ? `Rider in ${last.cell}` : 'Rider'} color={RIDER_COLOR} />)
          }

          const carAt = (id: number) => at(sim.xs[id], sim.ys[id])
          if (last.found >= 0) {
            const [fx, , fz] = carAt(last.found)
            const wrong = last.outcome === 'wrong'
            solids.push({ d: depth(fx, fz), node: <Car key="found" x={fx} z={fz} color={wrong ? 'var(--danger)' : CAR_COLOR} /> })
            if (tags.has('result') && wrong) labels.push(<Label key="found" x={fx} z={fz} top={CAR_TOP} lift={12} label="Not the nearest" color="var(--danger)" />)
          }
          if (last.outcome === 'wrong') {
            const [tx, , tz] = carAt(last.truth)
            solids.push({ d: depth(tx, tz), node: <Car key="truth" x={tx} z={tz} color={CAR_COLOR} /> })
            if (tags.has('result')) labels.push(<Label key="truth" x={tx} z={tz} top={CAR_TOP} lift={40} label="Really nearest" color={CAR_COLOR} />)
          }
          if (last.outcome === 'none' && tags.has('result')) {
            labels.push(<Label key="none" x={rx} z={rz} top={RIDER_TOP} lift={22} label="No car found" color="var(--danger)" />)
          }
          solids.sort((a, b) => a.d - b.d)
        }
        if (tags.has('crowd') && st.city === 'downtown') {
          labels.push(<Tag key="crowd" at={at(0.5, 0.5, 1.4)} label="Downtown" />)
        }

        return (
          <>
            <IsoBox x={0} z={0} w={MAP + 0.4} d={MAP + 0.4} h={0.06} stroke="var(--line)" />
            {last && (
              <g opacity={ramp}>
                {last.rects.map((r, i) => (
                  <path key={i} d={rectPath(r)} fill="var(--fg)" fillOpacity={0.1} stroke="var(--fg)" strokeWidth={1.2} strokeLinejoin="round" />
                ))}
              </g>
            )}
            {(st.method === 'grid' || st.method === 'geohash') && <path d={gridPath(st.res)} stroke="var(--muted)" strokeWidth={0.8} opacity={0.6} fill="none" />}
            {st.method === 'quadtree' && <path d={outlineOf(sim.leaves)} stroke="var(--muted)" strokeWidth={0.8} opacity={0.6} fill="none" />}
            <path d={still} fill="var(--muted)" opacity={0.75} />
            <path d={lit} fill={CHECKED_COLOR} />
            {last && last.found >= 0 && (
              <polyline
                points={points([at(last.rider.x, last.rider.y, FLOOR), at(sim.xs[last.found], sim.ys[last.found], FLOOR)])}
                stroke="var(--fg)"
                strokeWidth={1.2}
                strokeDasharray="5 5"
                fill="none"
              />
            )}
            {solids.map((s) => s.node)}
            {!quiet && labels}
          </>
        )
      }}
    </Viewport>
  )
}

// A label joined to a thing on the floor by a line from the top of its icon
// (`top` pixels up) to the label, `lift` pixels higher.
function Label({ x, z, top, lift, label, color }: { x: number; z: number; top: number; lift: number; label: string; color: string }) {
  const [sx, sy] = project([x, FLOOR, z])
  const text = label.toUpperCase()
  const w = text.length * 7.4 + 24
  const y = -top - lift
  return (
    <g transform={`translate(${sx} ${sy})`} className="pointer-events-none">
      <g className="tag-in">
        <line y1={-top} y2={y} stroke={color} />
        <rect x={-w / 2} y={y - 24} width={w} height={24} rx={12} fill="var(--bg)" stroke={color} />
        <text y={y - 8} textAnchor="middle" className="font-mono" fontSize={11} letterSpacing={1} fill={color}>
          {text}
        </text>
      </g>
    </g>
  )
}

// The rider: a small person on a ring.
function Rider({ x, z }: { x: number; z: number }) {
  const [sx, sy] = project([x, FLOOR, z])
  return (
    <g transform={`translate(${sx} ${sy})`}>
      <ellipse rx={9} ry={4.5} fill={RIDER_COLOR} fillOpacity={0.25} stroke={RIDER_COLOR} strokeWidth={1.2} />
      <circle cy={-14} r={3.6} fill={RIDER_COLOR} />
      <path d="M-5,0 L-5,-6 Q-5,-10 0,-10 Q5,-10 5,-6 L5,0 Z" fill={RIDER_COLOR} />
    </g>
  )
}

// A car the same size as the others, in a colour of its own.
function Car({ x, z, color }: { x: number; z: number; color: string }) {
  const [sx, sy] = project([x, FLOOR, z])
  return <path d={carPath(sx, sy)} fill={color} />
}
