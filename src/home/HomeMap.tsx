import { useEffect, useState, type KeyboardEvent } from 'react'
import { depth, points, project, S } from '../core/iso/geometry'
import { FloorPath, IsoBox, Tag } from '../core/iso/primitives'
import Viewport from '../core/iso/Viewport'
import { topicProgress, useProgress } from '../core/progress'
import type { V3 } from '../core/types'
import { TRACKS, type TopicEntry } from '../topics/registry'
import { DISTRICT_HALF, DISTRICTS, LOTS, STREETS, type Lot } from './cityLayout'
import { ContinueButton, Credit, ViewToggle, type HomeView } from './parts'
import { actionLabel, nextTopic, openTopic, statusOf, topicNumber, trackOf, type TopicStatus } from './shared'

const OVERVIEW = { target: [0, 0.8, 0] as V3, zoom: 1.05 }
const FOCUS_ZOOM = 2.1
const PHONE_ZOOM = 1.6

function useWide() {
  const query = '(min-width: 768px)'
  const [wide, setWide] = useState(() => window.matchMedia(query).matches)
  useEffect(() => {
    const mq = window.matchMedia(query)
    const onChange = () => setWide(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  return wide
}

export default function HomeMap({ onView }: { onView: (view: HomeView) => void }) {
  const progress = useProgress()
  const [selected, setSelected] = useState<string | null>(null)
  const [hovered, setHovered] = useState<string | null>(null)
  const wide = useWide()
  const next = nextTopic(progress)
  const lot = LOTS.find((l) => l.topic.id === selected)

  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => e.key === 'Escape' && setSelected(null)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Frame the chosen building beside the card: to the left of it on wide
  // screens, above it when the card is a sheet at the bottom. With nothing
  // chosen, wide screens see the whole city; phones start zoomed in on the
  // district of the next topic (the whole city would be too small to read).
  const home = DISTRICTS[(next ?? LOTS[0].topic).track]
  const target: V3 = lot
    ? wide
      ? [lot.x + 1, lot.h * 0.5, lot.z + 1]
      : [lot.x - 0.9, lot.h * 0.5, lot.z + 0.9]
    : wide
      ? OVERVIEW.target
      : [home.x - 0.6, 1, home.z + 0.6]
  const zoom = lot ? FOCUS_ZOOM : wide ? OVERVIEW.zoom : PHONE_ZOOM

  const select = (id: string) => setSelected((s) => (s === id ? null : id))

  return (
    <div className="relative h-[calc(100svh-57px)] min-h-[260px] w-full overflow-hidden">
      <div className="absolute inset-0">
        <Viewport
          target={target}
          zoom={zoom}
          shake={0}
          panKey={selected ?? 'overview'}
          label="City map of system design topics. Click a building to see it."
          controlsSide="left"
        >
          {() => (
            <City
              showDistricts={wide}
              progress={progress}
              selected={selected}
              hovered={hovered}
              nextId={next?.id}
              onSelect={select}
              onHover={setHovered}
              onClear={() => setSelected(null)}
            />
          )}
        </Viewport>
      </div>

      {/* Intro and continue: top-left on larger screens; at the bottom on
          phones, out of the way of the buildings (hidden while a card is open). */}
      <div
        className={`pointer-events-none absolute inset-x-3 bottom-3 max-w-sm space-y-2 sm:inset-x-auto sm:bottom-auto sm:left-4 sm:top-4 sm:space-y-3 ${
          lot ? 'hidden sm:block' : ''
        }`}
      >
        <div className="rounded-2xl border border-line bg-bg/80 p-3 backdrop-blur sm:p-4">
          <div className="hidden font-mono text-[10px] uppercase tracking-widest text-muted sm:block">System design, visually</div>
          <h1 className="text-base font-semibold tracking-tight sm:mt-1 sm:text-lg">Learn system design by breaking things.</h1>
          <p className="mt-1 text-sm text-muted">Tap a building to start. Pinch or drag to look around.</p>
        </div>
        <div className="pointer-events-auto">
          <ContinueButton />
        </div>
      </div>

      <div className="absolute right-3 top-3 z-30 sm:right-4 sm:top-4">
        <ViewToggle view="map" onChange={onView} />
      </div>

      <Legend />

      {!lot && <Credit className="absolute bottom-4 right-4 hidden rounded-full bg-bg/80 px-3 py-1 text-[11px] text-muted backdrop-blur sm:block" />}

      {lot && <TopicPanel key={lot.topic.id} topic={lot.topic} status={statusOf(progress, lot.topic)} onClose={() => setSelected(null)} />}
    </div>
  )
}

function City({
  showDistricts,
  progress,
  selected,
  hovered,
  nextId,
  onSelect,
  onHover,
  onClear,
}: {
  showDistricts: boolean
  progress: ReturnType<typeof useProgress>
  selected: string | null
  hovered: string | null
  nextId?: string
  onSelect: (id: string) => void
  onHover: (id: string | null) => void
  onClear: () => void
}) {
  const lots = [...LOTS].sort((a, b) => depth(a.x, a.z) - depth(b.x, b.z))

  return (
    <>
      {/* Clicking empty ground closes the card. */}
      <rect x={-3000} y={-3000} width={6000} height={6000} fill="transparent" onClick={onClear} />

      {STREETS.map((route, i) => (
        <FloorPath key={i} route={route} />
      ))}

      {TRACKS.map((track) => {
        const d = DISTRICTS[track.id]
        const r = DISTRICT_HALF
        return (
          <polygon
            key={track.id}
            points={points([
              [d.x - r, 0, d.z - r],
              [d.x - r, 0, d.z + r],
              [d.x + r, 0, d.z + r],
              [d.x + r, 0, d.z - r],
            ])}
            fill="var(--subtle)"
            fillOpacity={0.7}
            stroke="var(--line)"
            pointerEvents="none"
          />
        )
      })}

      {lots.map((l) => (
        <Building
          key={l.topic.id}
          lot={l}
          status={statusOf(progress, l.topic)}
          fraction={topicProgress(progress, l.topic.id).done.length / (l.topic.chapters?.length || 1)}
          selected={selected === l.topic.id}
          onSelect={() => onSelect(l.topic.id)}
          onHover={(on) => onHover(on ? l.topic.id : null)}
        />
      ))}

      {/* District names float just outside each district's outer corner (the
          left or right one on screen; downtown's is the back one, above its
          towers), clear of the buildings. Phones are zoomed into one
          district, where they'd only get in the way. */}
      {showDistricts && TRACKS.map((track) => {
        const d = DISTRICTS[track.id]
        const r = DISTRICT_HALF
        const side = Math.sign(d.x + d.z)
        if (side === 0) {
          const tallest = Math.max(...LOTS.filter((l) => l.topic.track === track.id).map((l) => l.h))
          return <Tag key={track.id} at={[d.x + r, tallest + 0.6, d.z - r]} label={track.title} />
        }
        const out = r + 0.9
        return <Tag key={track.id} at={[d.x + side * out, 0.3, d.z + side * out]} label={track.title} />
      })}

      {/* One label per building at most: chosen or hovered names it; otherwise "Next". */}
      {LOTS.map((l) => {
        const id = l.topic.id
        const named = id === selected || id === hovered
        if (!named && id !== nextId) return null
        return (
          <Tag
            key={`tag-${id}`}
            at={[l.x, l.h + 0.2, l.z]}
            label={named ? `${topicNumber(l.topic)} ${l.topic.title}` : 'Next'}
          />
        )
      })}
    </>
  )
}

// Splits a name into lines of at most `max` characters, at spaces.
function wrap(text: string, max: number) {
  const lines: string[] = []
  for (const word of text.split(' ')) {
    const last = lines.length - 1
    if (last >= 0 && lines[last].length + 1 + word.length <= max) lines[last] += ` ${word}`
    else lines.push(word)
  }
  return lines
}

// A topic's name, painted like a sign at the top of its building's front
// wall. Up to 7px, smaller when a long word wouldn't fit across the wall.
function WallSign({ lot, color }: { lot: Lot; color: string }) {
  const { x, z, size, h, topic } = lot
  const [sx, sy] = project([x - size / 2, h, z + size / 2])
  const pad = 3.5
  const room = size * S - pad * 2
  const name = (topic.short ?? topic.title).toUpperCase()
  const longest = Math.max(...name.split(' ').map((w) => w.length))
  const advance = 0.62 // em, the monospace character width, with a little slack
  const font = Math.min(7, room / (longest * advance))
  const lines = wrap(name, Math.floor(room / (font * advance)))
  return (
    <text transform={`matrix(0.866 -0.5 0 1 ${sx} ${sy})`} className="pointer-events-none font-mono" fontSize={font} fill={color}>
      {lines.map((line, i) => (
        <tspan key={line} x={pad} y={pad + 7 + i * 8.5}>
          {line}
        </tspan>
      ))}
    </text>
  )
}

function Building({
  lot,
  status,
  fraction,
  selected,
  onSelect,
  onHover,
}: {
  lot: Lot
  status: TopicStatus
  fraction: number
  selected: boolean
  onSelect: () => void
  onHover: (on: boolean) => void
}) {
  const { x, z, size, h, topic } = lot
  const ring = size / 2 + 0.22
  const [rx, ry] = project([x, h, z])
  const [poleX, poleY] = project([x, h + 0.75, z])

  // A thin bar on the floor in front of the building: how many chapters are done.
  const bar = (to: number): V3[] => {
    const z0 = z + size / 2 + 0.16
    const x0 = x - size / 2
    return [
      [x0, 0, z0],
      [x0, 0, z0 + 0.1],
      [x0 + size * to, 0, z0 + 0.1],
      [x0 + size * to, 0, z0],
    ]
  }
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      onSelect()
    }
  }

  return (
    <g
      role="button"
      tabIndex={0}
      aria-label={`${topic.title}${status === 'soon' ? ', coming soon' : status === 'done' ? ', done' : ''}`}
      aria-pressed={selected}
      className="cursor-pointer outline-none"
      onClick={(e) => {
        e.stopPropagation()
        onSelect()
      }}
      onKeyDown={onKey}
      onPointerEnter={() => onHover(true)}
      onPointerLeave={() => onHover(false)}
    >
      {selected && (
        <polygon
          points={points([
            [x - ring, 0, z - ring],
            [x - ring, 0, z + ring],
            [x + ring, 0, z + ring],
            [x + ring, 0, z - ring],
          ])}
          fill="none"
          stroke="var(--fg)"
          strokeWidth={2}
        />
      )}
      {status === 'soon' ? (
        <IsoBox x={x} z={z} w={size} d={size} h={h} ghost />
      ) : status === 'done' ? (
        <IsoBox x={x} z={z} w={size} d={size} h={h} fill="var(--fg)" />
      ) : (
        <IsoBox x={x} z={z} w={size} d={size} h={h} />
      )}
      <WallSign lot={lot} color={status === 'done' ? 'var(--bg)' : status === 'soon' ? 'var(--muted)' : 'var(--fg)'} />
      {/* Topic number on the roof, matching the list view. */}
      <text
        x={rx}
        y={ry + 4}
        textAnchor="middle"
        className="pointer-events-none font-mono"
        fontSize={11}
        fill={status === 'done' ? 'var(--bg)' : 'var(--muted)'}
      >
        {topicNumber(topic)}
      </text>

      {/* In progress: a floor bar. Completed: a flag on the roof. */}
      {status === 'started' && (
        <g pointerEvents="none">
          <polygon points={points(bar(1))} fill="var(--line)" />
          {fraction > 0 && <polygon points={points(bar(fraction))} fill="var(--fg)" />}
        </g>
      )}
      {status === 'done' && (
        <g pointerEvents="none">
          <line x1={rx + 9} y1={ry - 2} x2={poleX + 9} y2={poleY} stroke="var(--fg)" strokeWidth={1.5} />
          <path d={`M ${poleX + 9} ${poleY} l 15 5 l -15 5 z`} fill="var(--fg)" />
        </g>
      )}
    </g>
  )
}

// What the building styles mean.
function Legend() {
  const item = 'flex items-center gap-2'
  return (
    <div className="pointer-events-none absolute bottom-4 left-4 hidden rounded-xl border border-line bg-bg/80 px-3 py-2 text-[11px] text-muted backdrop-blur sm:block">
      <div className="space-y-1.5">
        <div className={item}>
          <span className="h-3 w-3 border border-fg bg-bg" /> Not started
        </div>
        <div className={item}>
          <span className="flex h-3 w-3 flex-col justify-end border border-fg bg-bg">
            <span className="h-0.5 w-1.5 bg-fg" />
          </span>
          In progress
        </div>
        <div className={item}>
          <span className="h-3 w-3 bg-fg" /> Completed ⚑
        </div>
        <div className={item}>
          <span className="h-3 w-3 border border-dashed border-muted" /> Coming soon
        </div>
      </div>
    </div>
  )
}

function StatusPill({ status }: { status: TopicStatus }) {
  if (status === 'done')
    return <span className="rounded-full bg-fg px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-widest text-bg">✓ Completed</span>
  if (status === 'started')
    return <span className="rounded-full border border-fg px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-widest">In progress</span>
  if (status === 'new')
    return <span className="rounded-full border border-line px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-widest text-muted">Not started</span>
  return null
}

function TopicPanel({ topic, status, onClose }: { topic: TopicEntry; status: TopicStatus; onClose: () => void }) {
  const progress = useProgress()
  const p = topicProgress(progress, topic.id)
  const track = trackOf(topic)

  return (
    <aside
      className="caption-in absolute inset-x-3 bottom-3 z-20 max-h-[60%] overflow-y-auto rounded-2xl border border-line bg-bg/95 p-5 shadow-lg backdrop-blur-md sm:inset-x-auto sm:bottom-auto sm:right-4 sm:top-16 sm:max-h-[calc(100%-5rem)] sm:w-96"
      aria-label={topic.title}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="font-mono text-[10px] uppercase tracking-widest text-muted">
          {topicNumber(topic)} · {track.title} · {track.level}
        </div>
        <button onClick={onClose} className="-mr-1 -mt-1 rounded-md px-1.5 text-muted transition hover:text-fg" aria-label="Close">
          ✕
        </button>
      </div>
      <h2 className="mt-2 text-xl font-semibold tracking-tight">{topic.title}</h2>
      <p className="mt-1 text-sm text-muted">{topic.pitch}</p>

      {status === 'soon' || !topic.chapters ? (
        <div className="mt-5 rounded-xl border border-dashed border-line p-4 text-sm text-muted">Coming soon.</div>
      ) : (
        <>
          <div className="mt-4">
            <StatusPill status={status} />
          </div>
          <ol className="mt-4 space-y-1">
            {topic.chapters.map((title, i) => (
              <li key={title}>
                <button
                  onClick={() => openTopic(topic, i)}
                  className="flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left text-sm transition hover:bg-subtle"
                >
                  <span className="font-mono text-xs text-muted">{String(i + 1).padStart(2, '0')}</span>
                  <span className="flex-1">{title}</span>
                  {p.done.includes(i) && <span className="font-mono text-xs">✓</span>}
                </button>
              </li>
            ))}
          </ol>
          <button
            onClick={() => openTopic(topic)}
            className="mt-4 w-full rounded-full bg-fg px-5 py-2.5 text-sm font-medium text-bg transition hover:opacity-85"
          >
            {actionLabel(status)} →
          </button>
        </>
      )}
    </aside>
  )
}
