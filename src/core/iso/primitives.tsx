import type { ReactNode } from 'react'
import type { Marker, V3 } from '../types'
import { depth, points, project, S } from './geometry'

// A box standing at (x, z), from height y up by h. Without `fill` it uses the
// neutral shades; with `fill` the side faces are darkened for depth. `ghost`
// draws a dashed outline, `dim` a switched-off grey box.
export function IsoBox({
  x,
  z,
  w,
  d,
  h,
  y = 0,
  fill,
  stroke = 'var(--fg)',
  opacity,
  ghost,
  dim,
}: {
  x: number
  z: number
  w: number
  d: number
  h: number
  y?: number
  fill?: string
  stroke?: string
  opacity?: number
  ghost?: boolean
  dim?: boolean
}) {
  const x0 = x - w / 2
  const x1 = x + w / 2
  const z0 = z - d / 2
  const z1 = z + d / 2
  const y1 = y + h
  const left: V3[] = [[x0, y, z0], [x0, y, z1], [x0, y1, z1], [x0, y1, z0]]
  const right: V3[] = [[x0, y, z1], [x1, y, z1], [x1, y1, z1], [x0, y1, z1]]
  const top: V3[] = [[x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0]]

  if (ghost) {
    const style = { fill: 'none', stroke: 'var(--muted)', strokeDasharray: '5 5', strokeWidth: 1 }
    return (
      <g>
        <polygon points={points(left)} {...style} />
        <polygon points={points(right)} {...style} />
        <polygon points={points(top)} {...style} />
      </g>
    )
  }

  const faces = dim
    ? ['var(--iso-idle)', 'var(--iso-idle)', 'var(--iso-idle)']
    : [fill ?? 'var(--iso-left)', fill ?? 'var(--iso-right)', fill ?? 'var(--iso-top)']
  const line = {
    stroke: fill && !dim ? 'none' : stroke,
    strokeWidth: 1.2,
    strokeLinejoin: 'round' as const,
    strokeDasharray: dim ? '4 4' : undefined,
  }

  return (
    <g opacity={opacity}>
      <polygon points={points(left)} fill={faces[0]} {...line} />
      {fill && <polygon points={points(left)} fill="#000" opacity={0.18} />}
      <polygon points={points(right)} fill={faces[1]} {...line} />
      {fill && <polygon points={points(right)} fill="#000" opacity={0.36} />}
      <polygon points={points(top)} fill={faces[2]} {...line} />
    </g>
  )
}

// An upright cylinder (the classic database shape) standing at (x, z).
export function IsoCylinder({
  x,
  z,
  r,
  h,
  y = 0,
  stroke = 'var(--fg)',
  dim,
  bands = [0.33, 0.66],
}: {
  x: number
  z: number
  r: number
  h: number
  y?: number
  stroke?: string
  dim?: boolean
  bands?: number[]
}) {
  // A floor circle of radius r projects to an axis-aligned ellipse.
  const rx = Math.SQRT2 * r * Math.cos(Math.PI / 6) * S
  const ry = (Math.SQRT2 * r * S) / 2
  const [cx, bottom] = project([x, y, z])
  const top = bottom - h * S
  const side = dim ? 'var(--iso-idle)' : 'var(--iso-right)'
  const lid = dim ? 'var(--iso-idle)' : 'var(--iso-top)'
  const frontArc = (cy: number) => `M ${cx - rx} ${cy} A ${rx} ${ry} 0 0 0 ${cx + rx} ${cy}`
  return (
    <g strokeDasharray={dim ? '4 4' : undefined}>
      <path
        d={`M ${cx - rx} ${top} L ${cx - rx} ${bottom} A ${rx} ${ry} 0 0 0 ${cx + rx} ${bottom} L ${cx + rx} ${top} Z`}
        fill={side}
        stroke={stroke}
        strokeWidth={1.2}
        strokeLinejoin="round"
      />
      {bands.map((f) => (
        <path key={f} d={frontArc(bottom - (bottom - top) * f)} fill="none" stroke="var(--line)" strokeWidth={2} />
      ))}
      <ellipse cx={cx} cy={top} rx={rx} ry={ry} fill={lid} stroke={stroke} strokeWidth={1.2} />
    </g>
  )
}

// A crowd of little people on a platform. One more lights up per request per
// second of traffic.
export function Crowd({ x, z = 0, active }: { x: number; z?: number; active: number }) {
  const cols = 4
  const rows = 3
  const people = Array.from({ length: cols * rows }, (_, i) => ({
    i,
    x: x + ((i % cols) - (cols - 1) / 2) * 0.42,
    z: z + (Math.floor(i / cols) - (rows - 1) / 2) * 0.45,
  })).sort((a, b) => depth(a.x, a.z) - depth(b.x, b.z))

  return (
    <g>
      <IsoBox x={x} z={z} w={1.9} d={1.6} h={0.06} stroke="var(--line)" />
      {people.map((p) => {
        const color = p.i < active ? 'var(--fg)' : 'var(--iso-idle)'
        const [hx, hy] = project([p.x, 0.58, p.z])
        return (
          <g key={p.i}>
            <IsoBox x={p.x} z={p.z} y={0.06} w={0.17} d={0.17} h={0.38} fill={color} />
            <circle cx={hx} cy={hy} r={0.1 * S} fill={color} />
          </g>
        )
      })}
    </g>
  )
}

// A flat square marking a spot on the floor.
export function FloorSpot({ x, z, size }: { x: number; z: number; size: number }) {
  const r = size / 2
  return (
    <polygon
      points={points([
        [x - r, 0, z - r],
        [x - r, 0, z + r],
        [x + r, 0, z + r],
        [x + r, 0, z - r],
      ])}
      fill="var(--subtle)"
      stroke="var(--line)"
    />
  )
}

// A dashed route painted on the floor.
export function FloorPath({ route }: { route: V3[] }) {
  return <polyline points={points(route)} stroke="var(--muted)" strokeWidth={1} strokeDasharray="5 5" fill="none" pointerEvents="none" />
}

export function IsoGrid() {
  const lines: ReactNode[] = []
  for (let v = -14; v <= 12; v += 0.5) {
    const major = v % 2.5 === 0
    lines.push(
      <polyline
        key={`x${v}`}
        points={points([[v, 0, -10], [v, 0, 10]])}
        stroke={major ? 'var(--muted)' : 'var(--line)'}
        strokeWidth={major ? 0.8 : 0.6}
        opacity={major ? 0.45 : 1}
      />,
    )
  }
  for (let v = -10; v <= 10; v += 0.5) {
    const major = v % 2.5 === 0
    lines.push(
      <polyline
        key={`z${v}`}
        points={points([[-14, 0, v], [12, 0, v]])}
        stroke={major ? 'var(--muted)' : 'var(--line)'}
        strokeWidth={major ? 0.8 : 0.6}
        opacity={major ? 0.45 : 1}
      />,
    )
  }
  return (
    <g>
      <defs>
        <radialGradient id="iso-grid-fade" cx="50%" cy="50%" r="50%">
          <stop offset="30%" stopColor="#fff" />
          <stop offset="100%" stopColor="#000" />
        </radialGradient>
        <mask id="iso-grid-mask" maskUnits="userSpaceOnUse" x={-900} y={-600} width={1700} height={1100}>
          <rect x={-900} y={-600} width={1700} height={1100} fill="url(#iso-grid-fade)" />
        </mask>
      </defs>
      <g mask="url(#iso-grid-mask)" fill="none">
        {lines}
      </g>
    </g>
  )
}

// A question's tap target (pulsing ring, outlined pill), or its answer once
// given (solid pill). Stops presses from starting a camera pan.
export function MarkerPin({ marker }: { marker: Marker }) {
  const [sx, sy] = project(marker.at)
  const ask = marker.tone === 'ask'
  const text = marker.label.toUpperCase()
  const w = text.length * 7.6 + 28
  return (
    <g transform={`translate(${sx} ${sy})`}>
      <g
        role={ask ? 'button' : undefined}
        aria-label={ask ? marker.label : undefined}
        className={ask ? 'cursor-pointer' : 'pointer-events-none'}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation()
          marker.onPick?.()
        }}
      >
        {/* A generous invisible hit area, for fingers. */}
        {ask && <rect x={-w / 2 - 8} y={-50} width={w + 16} height={62} fill="transparent" />}
        {ask && <circle r={9} className="marker-pulse" fill="none" stroke="var(--fg)" strokeWidth={1.5} />}
        <circle r={4} fill="var(--fg)" />
        <line y1={-4} y2={-16} stroke="var(--fg)" strokeWidth={1.5} />
        <g className="tag-in">
          <rect x={-w / 2} y={-44} width={w} height={28} rx={14} fill={ask ? 'var(--bg)' : 'var(--fg)'} stroke="var(--fg)" strokeWidth={1.5} />
          <text y={-25} textAnchor="middle" className="font-mono" fontSize={12} letterSpacing={1} fill={ask ? 'var(--fg)' : 'var(--bg)'}>
            {text}
          </text>
        </g>
      </g>
    </g>
  )
}

// A label pinned above a point in the world.
export function Tag({ at, label, danger, color: tint }: { at: V3; label: string; danger?: boolean; color?: string }) {
  const [sx, sy] = project(at)
  const text = label.toUpperCase()
  const w = text.length * 7.4 + 24
  const color = danger ? 'var(--danger)' : (tint ?? 'var(--fg)')
  return (
    <g transform={`translate(${sx} ${sy})`} className="pointer-events-none">
      <g className="tag-in">
        <line y1={0} y2={-14} stroke={color} />
        <rect x={-w / 2} y={-38} width={w} height={24} rx={12} fill={danger ? color : 'var(--bg)'} stroke={color} />
        <text y={-22} textAnchor="middle" className="font-mono" fontSize={11} letterSpacing={1} fill={danger ? 'var(--bg)' : 'var(--fg)'}>
          {text}
        </text>
      </g>
    </g>
  )
}
