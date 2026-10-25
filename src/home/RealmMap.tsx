import { useEffect, useId, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { PROJECTS } from './projects'
import { Castle, castleHeight } from './realmCastle'
import type { ProjectState } from './shared'

// The home map: each realm is its own hill, higher the harder it is, with a
// capital in its middle and the other castles around it. A single road runs
// through every castle in order, crossing from one hill to the next by a bridge. Castles under mist are not reached yet, but nothing is locked. The AI
// isles float apart and have no road.

type Pt = [number, number]

const pts = (p: Pt[]) => p.map((q) => q.join(',')).join(' ')

// A face colour: the page's ink mixed toward its background, so it reads in both themes.
const mix = (pct: number) => `color-mix(in srgb, var(--fg) ${pct}%, var(--bg))`

// A rounded, slightly uneven outline, clockwise on screen.
function blob(cx: number, cy: number, rx: number, ry: number, n: number, seed: number): Pt[] {
  return Array.from({ length: n }, (_, i) => {
    const th = -Math.PI + (i / n) * 2 * Math.PI
    const r = 1 + 0.05 * Math.sin(3 * th + seed) + 0.035 * Math.cos(5 * th + seed * 2)
    return [cx + rx * r * Math.cos(th), cy + ry * r * Math.sin(th)]
  })
}

// Cliff walls under the edges that face the viewer, each with its bottom points.
function cliffs(top: Pt[], drop: (p: Pt, i: number) => Pt) {
  const next = (i: number) => (i + 1) % top.length
  const area = top.reduce((a, [x, y], i) => a + x * top[next(i)][1] - top[next(i)][0] * y, 0)
  const s = Math.sign(area)
  return top.flatMap(([x, y], i) => {
    const [x2, y2] = top[next(i)]
    if (-s * (x2 - x) <= 0) return [] // faces away
    return [{ pts: [[x, y], [x2, y2], drop(top[next(i)], next(i)), drop([x, y], i)] as Pt[], lit: s * (y2 - y) < 0 }]
  })
}

const wallFill = (lit: boolean) => (lit ? mix(12) : mix(22))

interface Hill {
  c: Pt
  rx: number
  ry: number
  rise: number // how high it stands; its cliffs drop this far
  seed: number
  tier: string
  name: string
  at: Pt // where its name sits
}

// Back to front.
const HILLS: Hill[] = [
  { c: [800, 235], rx: 410, ry: 160, rise: 58, seed: 4, tier: 'EXPERT', name: 'The Hyperscale Kingdoms', at: [40, 180] },
  { c: [320, 430], rx: 180, ry: 80, rise: 40, seed: 3, tier: 'ADVANCED', name: 'The Distributed Highlands', at: [40, 330] },
  { c: [770, 565], rx: 240, ry: 100, rise: 26, seed: 2, tier: 'INTERMEDIATE', name: 'The Replica Cities', at: [1030, 600] },
  { c: [330, 670], rx: 250, ry: 75, rise: 12, seed: 1, tier: 'STARTER', name: 'The One-Server Shire', at: [30, 588] },
]

function HillLand({ h }: { h: Hill }) {
  const top = blob(h.c[0], h.c[1], h.rx, h.ry, 28, h.seed)
  const walls = cliffs(top, ([x, y]) => [x, y + h.rise])
  return (
    <g strokeLinejoin="round">
      {walls.map((w, i) => (
        <g key={i}>
          <polygon points={pts(w.pts)} style={{ fill: wallFill(w.lit), stroke: wallFill(w.lit) }} strokeWidth={0.8} />
          {/* Rock layers across the cliff. */}
          {Array.from({ length: Math.floor(h.rise / 9) }, (_, k) => (k + 1) * 9).map((z) => (
            <line key={z} x1={w.pts[0][0]} y1={w.pts[0][1] + z} x2={w.pts[1][0]} y2={w.pts[1][1] + z} style={{ stroke: mix(30) }} strokeWidth={0.6} opacity={0.5} />
          ))}
        </g>
      ))}
      <polygon points={pts(top)} style={{ fill: 'var(--subtle)', stroke: 'var(--line)' }} strokeWidth={1} />
    </g>
  )
}

// A floating isle: a rounded top with rock hanging under it, deepest in the middle.
function isle(cx: number, cy: number, rx: number, ry: number, hang: number, n: number) {
  const top = blob(cx, cy, rx, ry, n, 1)
  const under = cliffs(top, ([x, y], i) => {
    const d = (8 + hang * Math.max(0, 1 - ((x - cx) / rx) ** 2) ** 1.3) * (i % 2 ? 0.8 : 1)
    return [cx + (x - cx) * (1 - (0.5 * d) / (hang + 8)), y + d]
  })
  return { top, under }
}

const ISLES = [isle(1400, 380, 190, 110, 150, 20), isle(1236, 560, 26, 13, 34, 10), isle(1560, 560, 20, 10, 26, 10)]

function Isle({ top, under }: ReturnType<typeof isle>) {
  return (
    <g strokeLinejoin="round">
      {under.map((w, i) => (
        <polygon key={i} points={pts(w.pts)} style={{ fill: wallFill(w.lit), stroke: wallFill(w.lit) }} strokeWidth={0.8} />
      ))}
      <polygon points={pts(top)} style={{ fill: 'var(--subtle)', stroke: 'var(--line)' }} strokeWidth={1} />
    </g>
  )
}

// Each realm's capital stands bigger than the castles around it.
const CAPITALS: Record<string, number> = { 'url-shortener': 1.3, chat: 1.3, payments: 1.3, stripe: 1.3, 'llm-serving': 1.25 }

// Extra bends the road takes after a project: [x, y, stairs on the stretch after it].
// They carry it down off one hill and up the cliff of the next.
const VIA: Record<string, [number, number, boolean?][]> = {
  'web-crawler': [[550, 694, true], [596, 680, true], [612, 640]],
  'key-value-store': [[565, 540, true], [515, 585], [494, 522, true], [470, 476]],
  'ride-sharing': [[290, 360, true], [350, 330], [420, 318, true], [470, 300]],
}

// A smooth road through the points (Catmull-Rom as cubic curves), one piece per stretch.
function curve(p: Pt[], i: number) {
  const a = p[Math.max(i - 1, 0)]
  const b = p[i]
  const c = p[i + 1]
  const d = p[Math.min(i + 2, p.length - 1)]
  const c1: Pt = [b[0] + (c[0] - a[0]) / 6, b[1] + (c[1] - a[1]) / 6]
  const c2: Pt = [c[0] - (d[0] - b[0]) / 6, c[1] - (d[1] - b[1]) / 6]
  return `M${b.join(' ')} C${c1.join(' ')} ${c2.join(' ')} ${c.join(' ')}`
}

// Planks across a bridge between two hills: ticks across the deck.
function steps(b: Pt, c: Pt) {
  const len = Math.hypot(c[0] - b[0], c[1] - b[1])
  const [ux, uy] = [(c[0] - b[0]) / len, (c[1] - b[1]) / len]
  const n = Math.max(3, Math.floor(len / 6))
  return Array.from({ length: n - 1 }, (_, k) => {
    const t = (k + 1) / n
    const [x, y] = [b[0] + (c[0] - b[0]) * t, b[1] + (c[1] - b[1]) * t]
    return [x - uy * 8, y + ux * 8, x + uy * 8, y - ux * 8] as const
  })
}

// Mist over the lands not yet reached: centre x, y, radii, strength.
const MIST: [number, number, number, number, number][] = [
  [770, 565, 260, 110, 0.45],
  [320, 430, 200, 90, 0.7],
  [800, 235, 430, 170, 1],
  [1400, 380, 230, 150, 0.9],
]

// The whole map in viewBox units, and how far it zooms.
// TOP leaves headroom above the tallest banners.
const W = 1600
const H = 840
const TOP = -40
const ZOOM_MAX = 3.5
const ZOOM_STEP = 1.4

interface View {
  z: number
  cx: number // the map point at the centre of the box
  cy: number
}

const FIT: View = { z: 1, cx: W / 2, cy: TOP + H / 2 }

// The map opens this far in, centred on the current hill.
const HOME_ZOOM = 1.7
const HILL_OF_TIER = [HILLS[3], HILLS[2], HILLS[1], HILLS[0]]

// Keep the zoom in range and the view inside the map.
function clampView(v: View): View {
  const z = Math.min(Math.max(v.z, 1), ZOOM_MAX)
  const [w, h] = [W / z, H / z]
  return { z, cx: Math.min(Math.max(v.cx, w / 2), W - w / 2), cy: Math.min(Math.max(v.cy, TOP + h / 2), TOP + H - h / 2) }
}

// Zoom to z while the map point `at` stays where it is in the box.
const zoomAround = (v: View, z: number, at: Pt): View => {
  const k = v.z / clampView({ ...v, z }).z
  return clampView({ z, cx: at[0] + (v.cx - at[0]) * k, cy: at[1] + (v.cy - at[1]) * k })
}

function ZoomButton({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className="flex h-8 w-8 items-center justify-center rounded-full border border-line bg-bg/80 text-sm text-fg backdrop-blur transition hover:border-fg disabled:opacity-40 disabled:hover:border-line"
    >
      {children}
    </button>
  )
}

// How far below its base a castle's number and name sit, by tier.
const LABEL_DY = [26, 34, 38, 40, 34]

function RealmName({ tier, name, at, anchor = 'start' }: { tier: string; name: string; at: Pt; anchor?: 'start' | 'middle' }) {
  return (
    <g pointerEvents="none">
      <text x={at[0]} y={at[1]} textAnchor={anchor} className="fill-muted font-mono" fontSize={10} fontWeight={600} letterSpacing="0.18em">
        {tier}
      </text>
      <text x={at[0]} y={at[1] + 17} textAnchor={anchor} className="fill-fg" fontSize={13} fontWeight={600}>
        {name}
      </text>
    </g>
  )
}

export default function RealmMap({
  states,
  selected,
  onSelect,
}: {
  states: Record<string, ProjectState>
  selected: string
  onSelect: (id: string) => void
}) {
  const uid = useId().replace(/:/g, '')
  const grid = `grid${uid}`
  const fog = `fog${uid}`
  // The road joins the mainland only; the AI isles float apart.
  const road = PROJECTS.filter((p) => p.tier < 4)
  const litUntil = road.findIndex((p) => states[p.id] !== 'done')
  // Every bend of the road, tagged with the stretch (leg) between two projects it belongs to.
  const bends = road.flatMap((p, i) => [
    { at: [p.x, p.y + 12] as Pt, leg: i, stairs: false },
    ...(i < road.length - 1 ? (VIA[p.id] ?? []) : []).map(([x, y, s]) => ({ at: [x, y] as Pt, leg: i, stairs: !!s })),
  ])
  const line = bends.map((b) => b.at)
  const stretches = bends.slice(0, -1).map((b, i) => ({ ...b, i, d: curve(line, i), lit: litUntil === -1 || b.leg + 1 <= litUntil }))
  // Back to front, so castles nearer the viewer draw over the ones behind.
  const drawOrder = [...PROJECTS].sort((a, b) => a.y - b.y)

  // Open on the hill of the current castle (the first one not done), zoomed in part way.
  const current = road[litUntil === -1 ? road.length - 1 : litUntil]
  const [view, setView] = useState<View>(() => {
    const hill = HILL_OF_TIER[current.tier]
    return hill ? clampView({ z: HOME_ZOOM, cx: hill.c[0], cy: hill.c[1] - hill.rise }) : FIT
  })
  const svgRef = useRef<SVGSVGElement>(null)
  const drag = useRef<{ x: number; y: number; from: View; moved: boolean } | null>(null)
  const zoomed = view.z > 1
  const [vw, vh] = [W / view.z, H / view.z]
  const viewBox = `${view.cx - vw / 2} ${view.cy - vh / 2} ${vw} ${vh}`

  // Ctrl/Cmd + wheel (and trackpad pinch) zooms around the pointer; a plain wheel still scrolls the page.
  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      const r = svg.getBoundingClientRect()
      const [fx, fy] = [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height]
      setView((v) => {
        const at: Pt = [v.cx - W / v.z / 2 + fx * (W / v.z), v.cy - H / v.z / 2 + fy * (H / v.z)]
        return zoomAround(v, v.z * Math.exp(-e.deltaY * 0.01), at)
      })
    }
    svg.addEventListener('wheel', onWheel, { passive: false })
    return () => svg.removeEventListener('wheel', onWheel)
  }, [])

  // Dragging pans the map once it is zoomed in. A drag never counts as a tap on a castle.
  const onPointerDown = (e: ReactPointerEvent) => {
    if (!zoomed) return
    drag.current = { x: e.clientX, y: e.clientY, from: view, moved: false }
    const move = (ev: PointerEvent) => {
      const d = drag.current
      const r = svgRef.current?.getBoundingClientRect()
      if (!d || !r) return
      const [dx, dy] = [ev.clientX - d.x, ev.clientY - d.y]
      if (Math.hypot(dx, dy) > 4) d.moved = true
      if (!d.moved) return
      const k = W / d.from.z / r.width
      setView(clampView({ ...d.from, cx: d.from.cx - dx * k, cy: d.from.cy - dy * k }))
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      // Let the click that ends this drag see `moved`, then forget the drag.
      setTimeout(() => (drag.current = null))
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  return (
    <div className="relative">
      <div className="absolute right-3 top-3 z-10 flex flex-col gap-1.5">
        <ZoomButton label="Zoom in" onClick={() => setView((v) => zoomAround(v, v.z * ZOOM_STEP, [v.cx, v.cy]))} disabled={view.z >= ZOOM_MAX}>
          +
        </ZoomButton>
        <ZoomButton label="Zoom out" onClick={() => setView((v) => zoomAround(v, v.z / ZOOM_STEP, [v.cx, v.cy]))} disabled={!zoomed}>
          −
        </ZoomButton>
        <ZoomButton label="Show the whole map" onClick={() => setView(FIT)} disabled={!zoomed}>
          ⤢
        </ZoomButton>
      </div>
      <svg
        ref={svgRef}
        viewBox={viewBox}
        className={`block h-auto w-full select-none ${zoomed ? 'cursor-grab touch-none active:cursor-grabbing' : ''}`}
        style={{ aspectRatio: `${W} / ${H}` }}
        onPointerDown={onPointerDown}
        onClickCapture={(e) => {
          if (drag.current?.moved) e.stopPropagation()
        }}
        role="group" aria-label="Map of the system design projects: a hill for each realm, from the Starter shire to the Expert kingdoms, joined by one road, with the AI isles floating apart.">
        <defs>
          <pattern id={grid} width={60} height={34.64} patternUnits="userSpaceOnUse" patternTransform="skewX(-30)">
            <path d="M60 0H0V34.64" fill="none" style={{ stroke: 'var(--line)' }} strokeWidth={1} />
          </pattern>
          <radialGradient id={fog}>
            <stop offset="0" style={{ stopColor: 'var(--bg)' }} stopOpacity={0.55} />
            <stop offset="0.6" style={{ stopColor: 'var(--bg)' }} stopOpacity={0.35} />
            <stop offset="1" style={{ stopColor: 'var(--bg)' }} stopOpacity={0} />
          </radialGradient>
        </defs>
        <rect y={TOP} width={W} height={H} fill={`url(#${grid})`} />

        {/* The AI isles, with their shadow on the ground far below. */}
        <ellipse cx={1400} cy={720} rx={160} ry={18} fill="var(--fg)" opacity={0.06} />
        {ISLES.map((s, i) => (
          <Isle key={i} {...s} />
        ))}

        {/* The hills, back first. */}
        {HILLS.map((h) => (
          <HillLand key={h.tier} h={h} />
        ))}

        {/* The road, lit as far as the learner has come. */}
        {stretches.map((s) => (
          <path key={`edge${s.i}`} d={s.d} fill="none" style={{ stroke: s.stairs ? 'var(--fg)' : 'var(--line)' }} strokeWidth={s.stairs ? 18 : 10} strokeLinecap={s.stairs ? 'butt' : 'round'} />
        ))}
        {stretches.map((s) => (
          <path key={`bed${s.i}`} d={s.d} fill="none" style={{ stroke: 'var(--bg)' }} strokeWidth={s.stairs ? 15 : 7.5} strokeLinecap={s.stairs ? 'butt' : 'round'} />
        ))}
        {stretches
          .filter((s) => s.stairs)
          .flatMap((s) =>
            steps(line[s.i], line[s.i + 1]).map((t, k) => <line key={`step${s.i}-${k}`} x1={t[0]} y1={t[1]} x2={t[2]} y2={t[3]} style={{ stroke: mix(30) }} strokeWidth={1} />),
          )}
        {stretches.map((s) => (
          <path
            key={`lit${s.i}`}
            d={s.d}
            fill="none"
            style={{ stroke: s.lit ? 'var(--fg)' : 'var(--muted)' }}
            strokeWidth={s.lit ? 2 : 1.5}
            strokeDasharray={s.lit ? undefined : '4 6'}
            opacity={s.lit ? 1 : 0.7}
          />
        ))}

        {drawOrder.map((p) => {
          const state = states[p.id] ?? 'fog'
          const isSel = p.id === selected
          const k = CAPITALS[p.id] ?? 1
          const top = castleHeight(p) * k
          return (
            <g
              key={p.id}
              tabIndex={0}
              role="button"
              aria-label={`${PROJECTS.indexOf(p) + 1}. ${p.name}`}
              aria-pressed={isSel}
              className="cursor-pointer outline-none [&:focus-visible_.hit]:stroke-danger"
              onClick={() => onSelect(p.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  onSelect(p.id)
                }
              }}
            >
              <ellipse className="hit" cx={p.x} cy={p.y - top / 2 + 10} rx={62 * k} ry={top / 2 + 26} fill="transparent" stroke={isSel ? 'var(--danger)' : 'transparent'} strokeWidth={1.5} strokeDasharray={isSel ? '4 3' : undefined} />
              {state === 'next' && <ellipse className="realm-pulse" cx={p.x} cy={p.y + 6} rx={54 * k} ry={26 * k} fill="none" stroke="var(--danger)" strokeWidth={1.6} />}
              <Castle p={p} state={state} scale={k} />
            </g>
          )
        })}

        {/* Mist drifts over what is not reached yet. It never blocks a tap. */}
        <g className="realm-mist" pointerEvents="none">
          {MIST.map(([cx, cy, rx, ry, o]) => (
            <ellipse key={`${cx}-${cy}`} cx={cx} cy={cy} rx={rx} ry={ry} fill={`url(#${fog})`} opacity={o} />
          ))}
        </g>

        {/* Names sit above the mist so they stay readable. */}
        {HILLS.map((h) => (
          <RealmName key={h.tier} tier={h.tier} name={h.name} at={h.at} />
        ))}
        <RealmName tier="AI" name="The Model Isles" at={[1400, 680]} anchor="middle" />
        <g pointerEvents="none">
          {PROJECTS.map((p, i) => {
            const state = states[p.id] ?? 'fog'
            const dy = LABEL_DY[p.tier] * (CAPITALS[p.id] ?? 1)
            return (
              <g key={p.id}>
                <text x={p.x} y={p.y + dy} textAnchor="middle" className="fill-muted font-mono" fontSize={10} fontWeight={600}>
                  {String(i + 1).padStart(2, '0')}
                </text>
                <text x={p.x} y={p.y + dy + 14} textAnchor="middle" className="fill-fg" fontSize={p.tier >= 3 ? 11 : 12} fontWeight={600} opacity={state === 'fog' ? 0.85 : 1}>
                  {p.name}
                </text>
              </g>
            )
          })}
        </g>
      </svg>
    </div>
  )
}
