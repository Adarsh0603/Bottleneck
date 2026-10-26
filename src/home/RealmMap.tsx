import { memo, useCallback, useEffect, useId, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { COMPACT, SHORT, useMedia } from '../core/useMedia'
import ProjectCard from './ProjectCard'
import { PROJECTS, projectNumber, type Project } from './projects'
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
  anchor?: 'start' | 'end'
}

// Back to front.
const HILLS: Hill[] = [
  { c: [800, 235], rx: 410, ry: 160, rise: 58, seed: 4, tier: 'EXPERT', name: 'The Hyperscale Kingdoms', at: [440, 112], anchor: 'end' },
  { c: [320, 430], rx: 180, ry: 80, rise: 40, seed: 3, tier: 'ADVANCED', name: 'The Distributed Highlands', at: [40, 330] },
  { c: [770, 565], rx: 240, ry: 100, rise: 26, seed: 2, tier: 'INTERMEDIATE', name: 'The Replica Cities', at: [1030, 600] },
  { c: [330, 670], rx: 250, ry: 75, rise: 12, seed: 1, tier: 'STARTER', name: 'The One-Server Shire', at: [30, 588] },
]

// On a phone the writing is much bigger against the map, so each realm name moves to open
// water beside its hill: left of the Expert and Advanced hills, right of the other two.
const PHONE_NAMES: Record<string, { at: Pt; anchor?: 'start' | 'end' }> = {
  EXPERT: { at: [20, 40] },
  ADVANCED: { at: [10, 258] },
  INTERMEDIATE: { at: [1040, 610] },
  STARTER: { at: [600, 745] },
}
const PHONE_NAME_LS = 2 // the most the realm names grow on a phone

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
const CAPITALS: Record<string, number> = { 'url-shortener': 1.3, chat: 1.3, payments: 1.3, 'google-docs': 1.3, 'llm-serving': 1.25 }

// Extra bends the road takes after a project: [x, y, stairs on the stretch after it].
// They carry it down off one hill and up the cliff of the next.
const VIA: Record<string, [number, number, boolean?][]> = {
  'web-crawler': [[560, 688, true], [600, 630]],
  'key-value-store': [[545, 545, true], [470, 465]],
  'ride-sharing': [[400, 375, true], [480, 325]],
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
const ZOOM_MAX = 1.8 // the closest zoom; the drawing is laid out this large

interface View {
  z: number
  cx: number // the map point at the centre of the box
  cy: number
}

const FIT: View = { z: 1, cx: W / 2, cy: TOP + H / 2 }

// Tapping a castle flies in this far, centred on it.
const CLOSE_ZOOM = ZOOM_MAX
const FLIGHT_MS = 450

// How far a box may zoom, and the box's height over its width.
interface Limits {
  a: number
  minZ: number
  maxZ: number
}

const DESK: Limits = { a: H / W, minZ: 1, maxZ: ZOOM_MAX }

// Phones start close and pan; a pinch goes out to COMPACT_FAR and in to COMPACT_MAX.
// The drawing is laid out at the closest zoom.
const COMPACT_MIN = 2
const COMPACT_FAR = 1.3
const COMPACT_MAX = 3.6
const COMPACT_FOCUS = 2.8
// On a phone, full castle names show from this zoom in; farther out they shorten (Project.short) and the realm names show too.
const LABEL_ZOOM = 2.4
// The zoom the far writing is sized for.
const FAR_REF = 1.6

// Keep the zoom in range and the view inside the map. A map smaller than the box stays centred.
function clampView(v: View, { a, minZ, maxZ }: Limits = DESK): View {
  const z = Math.min(Math.max(v.z, minZ), maxZ)
  const inside = (c: number, size: number, from: number, len: number) =>
    size >= len ? from + len / 2 : Math.min(Math.max(c, from + size / 2), from + len - size / 2)
  return { z, cx: inside(v.cx, W / z, 0, W), cy: inside(v.cy, (a * W) / z, TOP, H) }
}

// The chosen project's card, standing over its castle. It keeps one size on screen however
// far the map is zoomed, and drops under the castle when there is no room above it.
const CARD_W = 340
const CARD_H = 330
const CARD_MIN = 280

function Bubble({ p, state, top, labelDy, zoom, width }: { p: Project; state: ProjectState; top: number; labelDy: number; zoom: number; width: number }) {
  const cw = Math.min(CARD_W, width - 24)
  const s = W / (width * zoom) // map units per screen pixel
  const wUnits = cw * s
  const baseY = p.y - top - 16
  const below = baseY - TOP < CARD_MIN * s
  const x = Math.min(Math.max(p.x - wUnits / 2, 8), W - 8 - wUnits)
  const y = below ? p.y + labelDy + 26 : baseY - CARD_H * s
  return (
    <foreignObject x={x} y={y} width={wUnits} height={CARD_H * s} style={{ overflow: 'visible' }} pointerEvents="none">
      <div
        className="pointer-events-none flex flex-col"
        style={{ width: cw, height: CARD_H, justifyContent: below ? 'flex-start' : 'flex-end', transform: `scale(${s})`, transformOrigin: 'top left' }}
      >
        <div className="pointer-events-auto cursor-default" onPointerDown={(e) => e.stopPropagation()}>
          <ProjectCard project={p} state={state} pointer={(p.x - (x + wUnits / 2)) / s} below={below} />
        </div>
      </div>
    </foreignObject>
  )
}

// How far below its base a castle's number and name sit, by tier.
const LABEL_DY = [26, 34, 38, 40, 34]

// Where to fly so the castle and its card both stay in view: as close as fits, with the
// castle and the card together in the middle of the box.
function focusOn(p: Project, width: number): View {
  const k = CAPITALS[p.id] ?? 1
  const tall = castleHeight(p) * k
  const label = LABEL_DY[p.tier] * k
  const boxH = (width * H) / W - 24
  let view = clampView({ z: 1, cx: p.x, cy: p.y - tall / 2 })
  for (let z = CLOSE_ZOOM; z >= 1; z = Math.round((z - 0.05) * 100) / 100) {
    const s = W / (width * z) // map units per screen pixel
    const card = CARD_H * s
    const baseY = p.y - tall - 16
    const below = baseY - TOP < CARD_MIN * s
    const [top, bottom] = below ? [p.y - tall, p.y + label + 26 + card] : [baseY - card, p.y + label]
    view = clampView({ z, cx: p.x, cy: (top + bottom) / 2 })
    if ((bottom - top) * ((width * z) / W) <= boxH) break
  }
  return view
}

function RealmName({ tier, name, at, anchor = 'start', ls }: { tier: string; name: string; at: Pt; anchor?: 'start' | 'middle' | 'end'; ls: number }) {
  return (
    <g pointerEvents="none">
      <text x={at[0]} y={at[1]} textAnchor={anchor} className="fill-muted font-mono" fontSize={10 * ls} fontWeight={600} letterSpacing="0.18em">
        {tier}
      </text>
      <text x={at[0]} y={at[1] + 17 * ls} textAnchor={anchor} className="fill-fg" fontSize={13 * ls} fontWeight={600}>
        {name}
      </text>
    </g>
  )
}

// Everything drawn on the map apart from the card. It only redraws when the progress or the
// chosen castle changes, not on every frame of a fly-in or a drag.
// `ls` grows the writing on a small screen, where the map is shrunk to a fraction of its size.
// `names` shows every castle's name (the chosen one always shows); `realms` shows the realm titles.
const Scene = memo(function Scene({ states, selected, fog, ls, names, realms, phone, onOpen, onBack }: { states: Record<string, ProjectState>; selected: string; fog: string; ls: number; names: boolean; realms: boolean; phone: boolean; onOpen: (p: Project) => void; onBack: () => void }) {
  // The road joins the mainland only; the AI isles float apart.
  const road = PROJECTS.filter((p) => p.tier < 4)
  const litUntil = road.findIndex((p) => states[p.id] !== 'done')
  // Every bend of the road, tagged with the stretch (leg) between two projects it belongs to.
  const bends = road.flatMap((p, i) => [
    { at: [p.x, p.y + 12] as Pt, leg: i, stairs: false },
    ...(i < road.length - 1 ? (VIA[p.id] ?? []) : []).map(([x, y, s]) => ({ at: [x, y] as Pt, leg: i, stairs: !!s })),
  ])
  const line = bends.map((b) => b.at)
  // Bridges and stairs run dead straight; the rest of the road bends.
  const stretches = bends.slice(0, -1).map((b, i) => ({ ...b, i, d: b.stairs ? `M${line[i].join(' ')} L${line[i + 1].join(' ')}` : curve(line, i), lit: litUntil === -1 || b.leg + 1 <= litUntil }))
  // Back to front, so castles nearer the viewer draw over the ones behind.
  const drawOrder = [...PROJECTS].sort((a, b) => a.y - b.y)
  return (
    <>
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
              aria-label={`${projectNumber(p)}. ${p.name}`}
              aria-pressed={isSel}
              className="cursor-pointer outline-none [&:focus-visible_.hit]:stroke-danger"
              onClick={() => onOpen(p)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  onOpen(p)
                } else if (e.key === 'Escape') onBack()
              }}
            >
              <ellipse className="hit" cx={p.x} cy={p.y - top / 2 + 10} rx={62 * k} ry={top / 2 + 26} fill="transparent" stroke="transparent" strokeWidth={1.5} />
              {isSel && <ellipse className="realm-pulse" cx={p.x} cy={p.y + 6} rx={54 * k} ry={26 * k} fill="none" stroke="var(--danger)" strokeWidth={1.6} />}
              <Castle p={p} state={state} scale={k} selected={isSel} />
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
        {realms && (
          <>
            {HILLS.map((h) => {
              const p = phone ? PHONE_NAMES[h.tier] : h
              return <RealmName key={h.tier} tier={h.tier} name={h.name} at={p.at} anchor={p.anchor} ls={phone ? Math.min(ls, PHONE_NAME_LS) : ls} />
            })}
            <RealmName tier="AI" name="The Model Isles" at={[1400, 680]} anchor="middle" ls={phone ? Math.min(ls, PHONE_NAME_LS) : ls} />
          </>
        )}
        <g pointerEvents="none">
          {PROJECTS.map((p) => {
            const state = states[p.id] ?? 'fog'
            const dy = LABEL_DY[p.tier] * (CAPITALS[p.id] ?? 1)
            return (
              <g key={p.id}>
                <text x={p.x} y={p.y + dy} textAnchor="middle" className="fill-muted font-mono" fontSize={10 * ls} fontWeight={600}>
                  {String(projectNumber(p)).padStart(2, '0')}
                </text>
                {(names || p.id === selected || phone) && (
                  <text x={p.x} y={p.y + dy + 14 * ls} textAnchor="middle" className="fill-fg" fontSize={(p.tier >= 3 ? 11 : 12) * ls} fontWeight={600} opacity={state === 'fog' ? 0.85 : 1}>
                    {names || p.id === selected ? p.name : p.short}
                  </text>
                )}
              </g>
            )
          })}
        </g>
    </>
  )
})

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
  const fog = `fog${uid}`

  // The map opens whole. Tapping a castle flies in on it and opens its card.
  // The drawing is laid out once at the closest zoom and only moved and scaled by CSS, so a
  // fly-in never redraws it: the browser slides one finished picture.
  // On a phone it opens close, on the chosen castle, and pans; the whole map never fits.
  const compact = useMedia(COMPACT)
  // A phone on its side has width to spare: the card lies over the map's right half.
  const short = useMedia(SHORT)
  const overlay = compact && short
  const [view, setView] = useState<View>(() => {
    const sel = PROJECTS.find((p) => p.id === selected)
    return compact && sel ? { z: COMPACT_MIN, cx: sel.x, cy: sel.y - 40 } : FIT
  })
  const [opened, setOpened] = useState<string | null>(null)
  const [moving, setMoving] = useState(false)
  const timer = useRef(0)
  const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const flyTo = (to: View, then?: () => void) => {
    clearTimeout(timer.current)
    setView(to)
    if (reduced()) {
      then?.()
      return
    }
    setMoving(true)
    timer.current = window.setTimeout(() => {
      setMoving(false)
      then?.()
    }, FLIGHT_MS)
  }
  useEffect(() => () => clearTimeout(timer.current), [])
  const openCastle = (p: Project) => {
    onSelect(p.id)
    setOpened(null)
    // Bring the whole map box into the page's view, under the sticky header, so the card is not cut off by the screen.
    boxRef.current?.scrollIntoView({ block: 'nearest', behavior: reduced() ? 'auto' : 'smooth' })
    if (!compact) return flyTo(focusOn(p, width), () => setOpened(p.id))
    // The card is outside the drawing here, so only the castle needs room: in the left half when the card covers the right.
    const z = Math.max(view.z, COMPACT_FOCUS)
    const cx = overlay ? p.x + (0.225 * W) / z : p.x
    flyTo(clampView({ z, cx, cy: p.y - (castleHeight(p) * (CAPITALS[p.id] ?? 1)) / 2 }, limits), () => setOpened(p.id))
  }
  const showAll = () => {
    setOpened(null)
    flyTo(compact ? { ...shown, z: limits.minZ } : FIT)
  }
  // The map's parts get steady handlers, so a frame of the fly-in does not redraw them.
  const latest = useRef({ openCastle, showAll })
  useEffect(() => {
    latest.current = { openCastle, showAll }
  })
  const open = useCallback((p: Project) => latest.current.openCastle(p), [])
  const back = useCallback(() => latest.current.showAll(), [])
  const boxRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(W)
  const [height, setHeight] = useState(0)
  useEffect(() => {
    const box = boxRef.current
    if (!box) return
    const watch = new ResizeObserver(() => {
      const r = box.getBoundingClientRect()
      setWidth(r.width || W)
      setHeight(r.height)
    })
    watch.observe(box)
    return () => watch.disconnect()
  }, [])
  const aspect = width && height ? height / width : H / W
  const limits: Limits = compact ? { a: aspect, minZ: COMPACT_FAR, maxZ: COMPACT_MAX } : DESK
  const layoutZoom = compact ? COMPACT_MAX : ZOOM_MAX
  const shown = clampView(view, limits)
  // On a phone, far out shows the realm titles and short castle names; close in shows the full names.
  const near = !compact || shown.z >= LABEL_ZOOM
  // The writing on the map is grown to stay readable at the zoom its level is seen from.
  const ls = compact ? Math.min(2.6, Math.max(1, Math.round((11 / (12 * (width / W) * (near ? LABEL_ZOOM : FAR_REF))) * 10) / 10)) : 1
  const live = useRef({ shown, limits, width, aspect })
  useEffect(() => {
    live.current = { shown, limits, width, aspect }
  })
  const cardRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (opened && compact && !overlay) cardRef.current?.scrollIntoView({ block: 'nearest', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
  }, [opened, compact, overlay])
  // One gesture from the first finger down to the last up: `at` and `dist` are where the fingers
  // started (dist is 0 for one finger), `from` the view then.
  const drag = useRef<{ at: Pt; dist: number; from: View; moved: boolean } | null>(null)
  const pointers = useRef(new Map<number, Pt>())
  const [dragging, setDragging] = useState(false)
  const openedProject = PROJECTS.find((p) => p.id === opened)
  const zoomed = shown.z > limits.minZ || compact
  // Where the drawing sits so that the view fills the box: its left and top edge in map units, in pixels.
  const px = (width / W) * shown.z
  const left = shown.cx - W / shown.z / 2
  const topEdge = shown.cy - (aspect * W) / shown.z / 2
  const place = `translate(${-left * px}px, ${-(topEdge - TOP) * px}px) scale(${shown.z / layoutZoom})`

  // One finger pans the map once it is zoomed in; two fingers pinch it, keeping the map under
  // their midpoint where it was. A drag or pinch never counts as a tap on a castle.
  const onPointerDown = (e: ReactPointerEvent) => {
    if (!zoomed || moving) return
    const down = pointers.current
    down.set(e.pointerId, [e.clientX, e.clientY])
    // Start the gesture over from the fingers now down and the view as drawn.
    const rebase = () => {
      const d = drag.current
      if (!d) return
      const [a, b] = [...down.values()]
      d.from = live.current.shown
      d.at = b ? [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] : a
      d.dist = b ? Math.hypot(a[0] - b[0], a[1] - b[1]) || 1 : 0
    }
    if (down.size > 1) return rebase()
    const g = { at: [e.clientX, e.clientY] as Pt, dist: 0, from: shown, moved: false }
    drag.current = g
    const move = (ev: PointerEvent) => {
      if (!down.has(ev.pointerId)) return
      down.set(ev.pointerId, [ev.clientX, ev.clientY])
      const { limits, width, aspect } = live.current
      const [a, b] = [...down.values()]
      const mid: Pt = b ? [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] : a
      const dist = b ? Math.hypot(a[0] - b[0], a[1] - b[1]) : 0
      if (!g.moved && (Math.hypot(mid[0] - g.at[0], mid[1] - g.at[1]) > 4 || Math.abs(dist - g.dist) > 4)) {
        g.moved = true
        setDragging(true)
      }
      if (!g.moved) return
      const f = g.from
      if (!b || !g.dist) {
        const k = W / f.z / width
        setView(clampView({ ...f, cx: f.cx - (mid[0] - g.at[0]) * k, cy: f.cy - (mid[1] - g.at[1]) * k }, limits))
        return
      }
      // The map point under the fingers at the start, kept under their midpoint now.
      const rect = boxRef.current?.getBoundingClientRect()
      if (!rect) return
      const p0 = (width / W) * f.z
      const ax = f.cx - W / f.z / 2 + (g.at[0] - rect.left) / p0
      const ay = f.cy - (aspect * W) / f.z / 2 + (g.at[1] - rect.top) / p0
      const z = Math.min(Math.max((f.z * dist) / g.dist, limits.minZ), limits.maxZ)
      const p1 = (width / W) * z
      setView(clampView({ z, cx: ax - (mid[0] - rect.left) / p1 + W / z / 2, cy: ay - (mid[1] - rect.top) / p1 + (aspect * W) / z / 2 }, limits))
    }
    const up = (ev: PointerEvent) => {
      if (!down.delete(ev.pointerId)) return
      // A finger is still down: carry on as a drag from here.
      if (down.size) return rebase()
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
      setDragging(false)
      // Let the click that ends this drag see `moved`, then forget the drag.
      setTimeout(() => {
        if (drag.current === g) drag.current = null
      })
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
  }

  return (
    <>
    <div
      ref={boxRef}
      className={`relative overflow-hidden ${moving || dragging ? 'realm-moving' : ''}`}
      style={{
        ...(compact ? { height: overlay ? 'calc(100svh - 96px)' : 'clamp(300px, 46svh, 520px)', minHeight: 240 } : { aspectRatio: `${W} / ${H}` }),
        scrollMarginTop: 72,
        scrollMarginBottom: 16,
      }}
    >
      <svg
        viewBox={`0 ${TOP} ${W} ${H}`}
        className={`absolute left-0 top-0 block select-none ${zoomed ? 'cursor-grab touch-none active:cursor-grabbing' : ''}`}
        style={{
          width: `${layoutZoom * 100}%`,
          aspectRatio: `${W} / ${H}`,
          transformOrigin: '0 0',
          transform: place,
          transition: dragging || reduced() ? 'none' : `transform ${FLIGHT_MS}ms cubic-bezier(0.33, 1, 0.68, 1)`,
          willChange: 'transform',
        }}
        onPointerDown={onPointerDown}
        onClickCapture={(e) => {
          if (drag.current?.moved) e.stopPropagation()
        }}
        onClick={(e) => {
          // A tap on the open sea flies back out to the whole map.
          if (shown.z > limits.minZ && !(e.target as Element).closest('[role="button"], foreignObject')) showAll()
        }}
        role="group" aria-label="Map of the system design projects: a hill for each realm, from the Starter shire to the Expert kingdoms, joined by one road, with the AI isles floating apart.">
        <defs>
          <radialGradient id={fog}>
            <stop offset="0" style={{ stopColor: 'var(--bg)' }} stopOpacity={0.55} />
            <stop offset="0.6" style={{ stopColor: 'var(--bg)' }} stopOpacity={0.35} />
            <stop offset="1" style={{ stopColor: 'var(--bg)' }} stopOpacity={0} />
          </radialGradient>
        </defs>

        <Scene states={states} selected={selected} fog={fog} ls={ls} names={near} realms={!compact || !near} phone={compact} onOpen={open} onBack={back} />

        {/* The chosen project, over its castle. Last, so nothing draws on top of it. */}
        {(() => {
          const sel = PROJECTS.find((p) => p.id === opened)
          if (!sel || compact) return null
          const k = CAPITALS[sel.id] ?? 1
          return <Bubble p={sel} state={states[sel.id] ?? 'fog'} top={castleHeight(sel) * k} labelDy={LABEL_DY[sel.tier] * k} zoom={shown.z} width={width} />
        })()}
      </svg>

      {overlay && openedProject && (
        <div className="absolute inset-y-2 right-2 z-10 w-[min(22rem,50%)] overflow-y-auto overscroll-contain">
          <ProjectCard project={openedProject} state={states[openedProject.id] ?? 'fog'} plain />
          <button onClick={back} aria-label="Close" className="absolute right-2 top-2 rounded-full border border-line bg-bg px-2 py-0.5 font-mono text-xs text-muted transition hover:text-fg">
            ✕
          </button>
        </div>
      )}
    </div>

    {compact && !overlay && openedProject && (
      <div ref={cardRef} className="mt-3 scroll-mb-4">
        <ProjectCard project={openedProject} state={states[openedProject.id] ?? 'fog'} plain />
      </div>
    )}
    </>
  )
}
