import { useEffect, useState, type KeyboardEvent } from 'react'
import { depth, points, project } from '../core/iso/geometry'
import { FloorPath, IsoBox, Tag } from '../core/iso/primitives'
import Viewport from '../core/iso/Viewport'
import { topicProgress, useProgress } from '../core/progress'
import type { V3 } from '../core/types'
import { TRACKS, type TopicEntry } from '../topics/registry'
import { DISTRICT_HALF, DISTRICTS, LOTS, STREETS, type Lot } from './cityLayout'
import { ContinueButton, ViewToggle, type HomeView } from './parts'
import { actionLabel, nextTopic, openTopic, statusOf, topicNumber, trackOf, type TopicStatus } from './shared'

const OVERVIEW = { target: [0, 0.8, 0] as V3, zoom: 1.05 }
const FOCUS_ZOOM = 2.1

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
  // screens, above it when the card is a sheet at the bottom.
  const target: V3 = lot
    ? wide
      ? [lot.x + 1, lot.h * 0.5, lot.z + 1]
      : [lot.x - 0.9, lot.h * 0.5, lot.z + 0.9]
    : OVERVIEW.target
  const zoom = lot ? FOCUS_ZOOM : OVERVIEW.zoom

  const select = (id: string) => setSelected((s) => (s === id ? null : id))

  return (
    <div className="relative h-[calc(100svh-57px)] min-h-[560px] w-full overflow-hidden">
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

      {/* Intro and continue, top-left. */}
      <div className="pointer-events-none absolute left-4 top-4 max-w-sm space-y-3">
        <div className="rounded-2xl border border-line bg-bg/80 p-4 backdrop-blur">
          <div className="font-mono text-[10px] uppercase tracking-widest text-muted">System design, visually</div>
          <h1 className="mt-1 text-lg font-semibold tracking-tight">Learn system design by breaking things.</h1>
          <p className="mt-1 text-sm text-muted">Pick a building to start.</p>
        </div>
        <div className="pointer-events-auto">
          <ContinueButton />
        </div>
      </div>

      <div className="absolute right-4 top-4 z-30">
        <ViewToggle view="map" onChange={onView} />
      </div>

      {lot && <TopicPanel key={lot.topic.id} topic={lot.topic} status={statusOf(progress, lot.topic)} onClose={() => setSelected(null)} />}
    </div>
  )
}

function City({
  progress,
  selected,
  hovered,
  nextId,
  onSelect,
  onHover,
  onClear,
}: {
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
          selected={selected === l.topic.id}
          onSelect={() => onSelect(l.topic.id)}
          onHover={(on) => onHover(on ? l.topic.id : null)}
        />
      ))}

      {/* District names float above each district's back corner. */}
      {TRACKS.map((track) => {
        const d = DISTRICTS[track.id]
        const tallest = Math.max(...LOTS.filter((l) => l.topic.track === track.id).map((l) => l.h))
        return <Tag key={track.id} at={[d.x + DISTRICT_HALF, tallest + 0.6, d.z - DISTRICT_HALF]} label={track.title} />
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

function Building({
  lot,
  status,
  selected,
  onSelect,
  onHover,
}: {
  lot: Lot
  status: TopicStatus
  selected: boolean
  onSelect: () => void
  onHover: (on: boolean) => void
}) {
  const { x, z, size, h, topic } = lot
  const ring = size / 2 + 0.22
  const [rx, ry] = project([x, h, z])
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
    </g>
  )
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
          <div className="mt-5 font-mono text-[11px] text-muted">
            {p.done.length} / {topic.chapters.length} chapters
          </div>
          <ol className="mt-2 space-y-1">
            {topic.chapters.map((title, i) => (
              <li key={title}>
                <button
                  onClick={() => openTopic(progress, topic, i)}
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
            onClick={() => openTopic(progress, topic)}
            className="mt-4 w-full rounded-full bg-fg px-5 py-2.5 text-sm font-medium text-bg transition hover:opacity-85"
          >
            {actionLabel(status)} →
          </button>
        </>
      )}
    </aside>
  )
}
