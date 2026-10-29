import type { Project } from './projects'
import type { ProjectState } from './shared'

// The castles on the realm map: one plan per tier, grander as the road climbs,
// each flying a banner with the emblem of the system it stands for.

type Pt = [number, number]

const pts = (p: Pt[]) => p.map((q) => q.join(',')).join(' ')

// A face colour: the page's ink mixed toward its background, so it reads in both themes.
const mix = (pct: number) => `color-mix(in srgb, var(--fg) ${pct}%, var(--bg))`

// A point in iso ground units: u runs toward the front-right, v toward the front-left, z up.
const iso = (x: number, y: number, u: number, v: number, z = 0): Pt => [x + u - v, y + (u + v) / 2 - z]

interface Part {
  u: number
  v: number
  a: number // half-length along u
  b: number // half-length along v
  h: number
  z?: number // stands on something this tall
  roof?: number // a pyramid roof this tall
  merlons?: boolean
  gate?: boolean
  slits?: boolean
}

// Parts are listed back to front, so later ones draw over earlier ones.
interface Plan {
  parts: Part[]
  flag: [number, number, number] // where the banner pole stands: u, v, z
}

// A square curtain wall with a tower on each corner; the gate faces the viewer's left.
function ring(R: number, wall: number, t: number, tower: Omit<Part, 'u' | 'v'>, gateTowers: boolean) {
  const w = (u: number, v: number, a: number, b: number, gate = false): Part => ({ u, v, a, b, h: wall, merlons: true, gate })
  const back: Part[] = [{ ...tower, u: -R, v: -R }, w(0, -R, R, t), w(-R, 0, t, R), { ...tower, u: R, v: -R }, { ...tower, u: -R, v: R }]
  const front: Part[] = [w(0, R, R, t, true), w(R, 0, t, R)]
  if (gateTowers) for (const u of [-7, 7]) front.push({ u, v: R, a: 3, b: 3.6, h: wall + 6, merlons: true })
  front.push({ ...tower, u: R, v: R })
  return { back, front }
}

function plan(tier: number): Plan {
  if (tier === 0) {
    return {
      parts: [
        { u: 0, v: 0, a: 9, b: 9, h: 24, merlons: true, gate: true, slits: true },
        { u: 16, v: -4, a: 4.5, b: 4.5, h: 17, roof: 11, slits: true },
        { u: -4, v: 16, a: 6, b: 3.5, h: 8, roof: 7 },
      ],
      flag: [0, 0, 24],
    }
  }
  if (tier === 1) {
    const r = ring(15, 10, 2.2, { a: 4.2, b: 4.2, h: 18, roof: 10 }, false)
    return { parts: [...r.back, { u: 0, v: 0, a: 8, b: 8, h: 28, merlons: true, slits: true }, ...r.front], flag: [0, 0, 28] }
  }
  if (tier === 2) {
    const r = ring(18, 12, 2.5, { a: 5, b: 5, h: 23, roof: 13 }, false)
    const keep: Part[] = [
      { u: 0, v: 0, a: 9.5, b: 9.5, h: 32, slits: true },
      { u: 0, v: 0, z: 32, a: 6, b: 6, h: 12, merlons: true, slits: true },
    ]
    return { parts: [...r.back, ...keep, ...r.front], flag: [0, 0, 44] }
  }
  if (tier === 3) {
    const r = ring(21, 14, 2.8, { a: 6, b: 6, h: 30, roof: 18 }, true)
    const keep: Part[] = [
      { u: 0, v: 0, a: 11, b: 11, h: 40, slits: true },
      { u: 0, v: 0, z: 40, a: 7, b: 7, h: 18, merlons: true, slits: true },
    ]
    return { parts: [...r.back, ...keep, ...r.front], flag: [0, 0, 58] }
  }
  // AI: a machine tower on a plinth, flat-topped, no walls.
  return {
    parts: [
      { u: 0, v: 0, a: 12, b: 12, h: 5 },
      { u: 0, v: 0, z: 5, a: 7, b: 7, h: 32, slits: true },
      { u: 0, v: 0, z: 37, a: 4.5, b: 4.5, h: 7 },
    ],
    flag: [0, 0, 44],
  }
}

const MERLON_RISE = 1.3

const merlonSize = (p: Part) => (Math.min(p.a, p.b) <= 3 ? Math.min(1.5, Math.min(p.a, p.b) * 0.6) : Math.min(2.6, Math.max(1.5, Math.min(p.a, p.b) / 3.5)))

// Battlement teeth along the rim of a part's top, back to front. A thin wall gets one row.
function merlons(p: Part): Part[] {
  const m = merlonSize(p)
  const row = (alongU: boolean, at: number, len: number): [number, number][] => {
    const n = Math.max(2, Math.floor((2 * len) / (m * 2.8)) + 1)
    return Array.from({ length: n }, (_, i) => -len + m + ((2 * len - 2 * m) * i) / (n - 1)).map((k) => (alongU ? [k, at] : [at, k]))
  }
  let spots: [number, number][]
  if (p.b <= 3) spots = row(true, 0, p.a)
  else if (p.a <= 3) spots = row(false, 0, p.b)
  else {
    const [A, B] = [p.a - m, p.b - m]
    spots = [...row(true, -B, p.a), ...row(false, -A, p.b), ...row(true, B, p.a), ...row(false, A, p.b)]
  }
  return spots
    .sort((s, t) => s[0] + s[1] - (t[0] + t[1]))
    .map(([du, dv]) => ({ u: p.u + du, v: p.v + dv, a: m, b: m, h: m * MERLON_RISE, z: (p.z ?? 0) + p.h }))
}

function skin(state: ProjectState, selected: boolean) {
  const done = state === 'done'
  return {
    done,
    stroke: done || selected ? 'var(--fg)' : 'var(--muted)',
    top: done ? 'var(--fg)' : 'var(--iso-top)',
    left: done ? mix(72) : 'var(--iso-left)',
    right: done ? mix(52) : 'var(--iso-right)',
    roofLeft: done ? mix(86) : 'var(--iso-top)',
    roofRight: done ? mix(64) : 'var(--iso-left)',
    dark: done ? 'var(--bg)' : 'var(--fg)', // gates and windows
  }
}

type Skin = ReturnType<typeof skin>

function Block({ x, y, p, s, thin }: { x: number; y: number; p: Part; s: Skin; thin?: boolean }) {
  const z0 = p.z ?? 0
  const P = (su: number, sv: number, z: number) => iso(x, y, p.u + su * p.a, p.v + sv * p.b, z0 + z)
  const face = (fill: string) => ({ fill, stroke: s.stroke, strokeWidth: thin ? 0.7 : 1 })
  const apex = iso(x, y, p.u, p.v, z0 + p.h + (p.roof ?? 0))
  // A gate arch on the left face, in that face's own coordinates (across, up).
  const dw = Math.min(0.32, 4 / p.a)
  const gh = Math.min(p.h * 0.6, 9)
  const arch: [number, number][] = [[-dw, 0], [-dw, 0.7], [-dw * 0.6, 0.92], [0, 1], [dw * 0.6, 0.92], [dw, 0.7], [dw, 0]]
  const slitL = 0.8 / p.a
  const slitR = 0.8 / p.b
  return (
    <g strokeLinejoin="round">
      <polygon points={pts([P(-1, 1, 0), P(1, 1, 0), P(1, 1, p.h), P(-1, 1, p.h)])} style={face(s.left)} />
      <polygon points={pts([P(1, -1, 0), P(1, 1, 0), P(1, 1, p.h), P(1, -1, p.h)])} style={face(s.right)} />
      {p.roof ? (
        <>
          <polygon points={pts([P(-1, 1, p.h), P(1, 1, p.h), apex])} style={face(s.roofLeft)} />
          <polygon points={pts([P(1, -1, p.h), P(1, 1, p.h), apex])} style={face(s.roofRight)} />
        </>
      ) : (
        <polygon points={pts([P(-1, -1, p.h), P(1, -1, p.h), P(1, 1, p.h), P(-1, 1, p.h)])} style={face(s.top)} />
      )}
      {p.gate && <polygon points={pts(arch.map(([a, up]) => P(a, 1, up * gh)))} fill={s.dark} opacity={0.6} />}
      {p.slits && (
        <g fill={s.dark} opacity={0.5}>
          <polygon points={pts([P(-slitL, 1, p.h * 0.62), P(slitL, 1, p.h * 0.62), P(slitL, 1, p.h * 0.8), P(-slitL, 1, p.h * 0.8)])} />
          <polygon points={pts([P(1, -slitR, p.h * 0.62), P(1, slitR, p.h * 0.62), P(1, slitR, p.h * 0.8), P(1, -slitR, p.h * 0.8)])} />
        </g>
      )}
      {p.merlons && merlons(p).map((q, i) => <Block key={i} x={x} y={y} p={q} s={s} thin />)}
    </g>
  )
}

const bannerScale = (tier: number) => (tier === 3 ? 1.1 : 1)
const POLE = 31

// How tall the castle stands, banner included.
export function castleHeight(p: Project) {
  const pl = plan(p.tier)
  const top = pl.parts.find((q) => (q.z ?? 0) + q.h === pl.flag[2])
  const rise = top?.merlons ? merlonSize(top) * MERLON_RISE : 0
  return pl.flag[2] + rise + POLE * bannerScale(p.tier)
}

// scale > 1 draws a realm's capital, bigger than the castles around it.
export function Castle({ p, state, scale = 1, selected = false }: { p: Project; state: ProjectState; scale?: number; selected?: boolean }) {
  const s = skin(state, selected)
  const pl = plan(p.tier)
  const [fu, fv, fz] = pl.flag
  const pole = iso(p.x, p.y, fu, fv, fz)
  const k = bannerScale(p.tier)
  const topPart = pl.parts.find((q) => (q.z ?? 0) + q.h === fz)
  const lift = topPart?.merlons ? merlonSize(topPart) * MERLON_RISE : 0
  const flagFill = s.done ? 'var(--srv-3)' : 'var(--iso-top)'
  return (
    <g opacity={state === 'fog' ? 0.85 : 1} transform={scale === 1 ? undefined : `translate(${p.x} ${p.y}) scale(${scale}) translate(${-p.x} ${-p.y})`}>
      {pl.parts.map((q, i) => (
        <Block key={i} x={p.x} y={p.y} p={q} s={s} />
      ))}
      {p.tier === 4 && <line x1={p.x + 6} y1={pole[1] - 2} x2={p.x + 6} y2={pole[1] - 16} stroke={s.stroke} strokeWidth={1.2} />}
      <g transform={`translate(${pole[0]} ${pole[1] - lift}) scale(${k})`}>
        <line x1={0} y1={0} x2={0} y2={-POLE} stroke={s.stroke} strokeWidth={1.3} />
        <polygon points={`0,-${POLE} 27,-${POLE} 22,-${POLE - 9.5} 27,-${POLE - 19} 0,-${POLE - 19}`} style={{ fill: flagFill, stroke: s.done ? 'var(--srv-3)' : s.stroke }} strokeWidth={1} strokeLinejoin="round" />
        <path
          d={EMBLEM[p.id] ?? ''}
          transform={`translate(11.5 -${POLE - 9.5}) scale(1.1)`}
          fill="none"
          stroke={s.done ? '#fff' : s.stroke}
          strokeWidth={1.1}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </g>
    </g>
  )
}

// One small glyph per system, drawn in a 12 x 12 box around 0,0.
const ring2 = (cx: number, cy: number, r: number) => `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0`

const EMBLEM: Record<string, string> = {
  'url-shortener': 'M-0.5-3.5l1.5-1.5a2.5 2.5 0 0 1 3.5 3.5l-1.5 1.5M0.5 3.5l-1.5 1.5a2.5 2.5 0 0 1-3.5-3.5l1.5-1.5M-2 2L2-2',
  notifications: 'M-4 2.5h8l-1.2-1.6v-2.4a2.8 2.8 0 0 0-5.6 0v2.4zM-1 4.4h2',
  'web-crawler': `${ring2(0, -0.5, 1.6)}M-1.4-1.4l-3-2.6M1.4-1.4l3-2.6M-1.6 0l-3.6 0.4M1.6 0l3.6 0.4M-1.1 0.9l-2.8 3.2M1.1 0.9l2.8 3.2M0-2.1v-2.9`,
  'news-feed': 'M-4.5-4h9v8h-9zM-3-2h6M-3 0h6M-3 2h4',
  chat: 'M-4.5-3.5h9v6h-5l-2.5 2.5v-2.5h-1.5z',
  'video-streaming': 'M-2.5-3.5L3.5 0L-2.5 3.5Z',
  'key-value-store': `${ring2(-2.5, 0, 2)}M-0.5 0H4.5M3 0v2M4.5 0v1.6`,
  payments: `${ring2(0, 0, 4.5)}M1.6-1.8c-0.5-0.8-3.2-0.8-3.2 0.6c0 1.6 3.4 0.8 3.4 2.6c0 1.4-2.8 1.4-3.4 0.4M0-3.2v6.4`,
  'ride-sharing': `M-5 1.6v-2.2l1.6-2.3h6.8l1.6 2.3v2.2zM-5-0.6h10${ring2(-2.8, 2.4, 1.1)}${ring2(2.8, 2.4, 1.1)}`,
  'twitter-timeline': 'M-5 2.5c2.5 1.6 6.5 0.6 7.5-3.5l1.6-1.4l-1.8 0.2c-0.8-1.2-2.8-1-3 0.8c-1.8 0-3-0.8-4-2c-0.4 1.4 0 2.6 1.2 3.2c-0.6 0.2-1.2 0-1.6-0.2c0.2 1 1 1.6 2 1.8c-0.6 0.6-1.2 0.9-1.9 1.1z',
  whatsapp: 'M-5.5 0l2.2 2.4l4-4.8M-0.6 1.8l0.6 0.6l4.5-4.8',
  dropbox: 'M0-4.5l4.5 2.2v4.6L0 4.5l-4.5-2.2v-4.6zM-4.5-2.3L0 0l4.5-2.3M0 0v4.5',
  'google-docs': 'M-3.5-5h4.5l2.5 2.5v7.5h-7zM1-5v2.5h2.5M-2 0h4M-2 2h4',
  ticketmaster: 'M-5-3h10v2a1 1 0 0 0 0 2v2h-10v-2a1 1 0 0 0 0-2zM1-3v1.2M1-0.6v1.2M1 1.8v1.2',
  uber: `M0 5c-3-3.2-4.2-5-4.2-7a4.2 4.2 0 0 1 8.4 0c0 2-1.2 3.8-4.2 7z${ring2(0, -2, 1.4)}`,
  kafka: 'M-5.5-2h3v4h-3zM-1.5-2h3v4h-3zM2.5-2h3v4h-3zM-5.5 4h11',
  youtube: 'M-4.5-3.5h9a1.5 1.5 0 0 1 1.5 1.5v4a1.5 1.5 0 0 1-1.5 1.5h-9a1.5 1.5 0 0 1-1.5-1.5v-4a1.5 1.5 0 0 1 1.5-1.5zM-1.2-1.7l3 1.7l-3 1.7z',
  'google-search': `${ring2(-1, -1, 3)}M1.2 1.2L4.5 4.5`,
  stripe: 'M-5-3.5h10v7h-10zM-5-1.5h10M-3 1.8h2.5',
  'doc-qa': 'M-3.5-5h7v10h-7zM-1.4-1.4a1.4 1.4 0 1 1 1.4 1.4v1M0 2.6v0.2',
  'semantic-search': 'M0-5C0.6-1 1-0.6 5 0C1 0.6 0.6 1 0 5C-0.6 1-1 0.6-5 0C-1-0.6-0.6-1 0-5Z',
  'llm-gateway': 'M-5 4.5v-5.5a5 4 0 0 1 10 0v5.5M-2.5 4.5v-3.5a2.5 2.5 0 0 1 5 0v3.5M-5.5 4.5h11',
  'support-agent': 'M-4 1v-1.5a4 4 0 0 1 8 0v1.5M-4.6 0.5h1.6v3h-1.6zM3 0.5h1.6v3h-1.6zM3.8 3.5q0 1.5-2.5 1.5',
  'coding-assistant': 'M-2-3.5L-5 0L-2 3.5M2-3.5L5 0L2 3.5M0.8-4L-0.8 4',
  'llm-serving': 'M-3-3h6v6h-6zM-1-1h2v2h-2zM-1.5-3v-1.8M1.5-3v-1.8M-1.5 3v1.8M1.5 3v1.8M-3-1.5h-1.8M-3 1.5h-1.8M3-1.5h1.8M3 1.5h1.8',
  'multi-agent': `${ring2(0, -3.5, 1.6)}${ring2(-3.5, 3, 1.6)}${ring2(3.5, 3, 1.6)}M-0.8-2L-2.7 1.6M0.8-2L2.7 1.6M-1.9 3H1.9`,
}
