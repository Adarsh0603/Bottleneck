import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { TopBar } from '../chrome'
import { Stepper } from '../controls'
import { ArrowIcon, Chip, ClockIcon, CrossIcon, GaugeIcon } from '../hud'
import { play } from '../sound'
import type { Level } from '../types'
import { COMPACT, SHORT, useMedia } from '../useMedia'
import BuildScene from './BuildScene'
import { PieceIcon } from './pieces'
import { canDrop, drop, lift, remaining } from './placement'
import { Source } from '../flow/nodes'
import { MS_PER_TICK, Running, TICKS_PER_SECOND } from './run'
import { PIECE_NAMES, type BuildTask, type PieceKind, type Placement, type Settings } from './types'

interface Drag {
  kind: PieceKind
  fromPad?: string
  startX: number
  startY: number
  x: number
  y: number
  moved: boolean
}

// The pad under a screen point, if any (pads carry a data-pad attribute).
const padAt = (x: number, y: number) => document.elementFromPoint(x, y)?.closest('[data-pad]')?.getAttribute('data-pad') ?? null

// A "Build it" chapter: drag pieces onto the floor while live traffic runs
// through whatever has been built, until the goal holds.
export default function BuildPlayer({
  task,
  chapters,
  index,
  doneChapters,
  onChapter,
  onStep,
  onSolved,
  onFinish,
}: {
  task: BuildTask
  chapters: { title: string; level: Level }[]
  index: number
  doneChapters: number[]
  onChapter: (index: number) => void
  onStep?: (step: number, isLastStep: boolean) => void
  onSolved?: (step: number) => void
  onFinish?: () => void
}) {
  const [placed, setPlaced] = useState<Placement>({})
  const [selected, setSelected] = useState<PieceKind | null>(null)
  const [drag, setDrag] = useState<Drag | null>(null)
  const [hoverPad, setHoverPad] = useState<string | null>(null)
  const [solved, setSolved] = useState(false)
  const [, setFrame] = useState(0)
  const compact = useMedia(COMPACT)
  const short = useMedia(SHORT)
  const lastChapter = index === chapters.length - 1

  const [settings, setSettings] = useState<Settings>(() =>
    Object.fromEntries((task.settings ?? []).map((s) => [s.id, s.initial])),
  )
  const settingsRef = useRef(settings)
  settingsRef.current = settings

  // The live system, rebuilt from scratch whenever the placement or a setting changes.
  const runRef = useRef<Running | null>(null)
  if (!runRef.current) runRef.current = new Running(task.assemble({}, settings))
  const run = runRef.current
  const lastTickAt = useRef(0)
  useEffect(() => {
    const id = setInterval(() => {
      runRef.current!.step()
      lastTickAt.current = performance.now()
      setFrame((f) => f + 1)
    }, MS_PER_TICK)
    return () => clearInterval(id)
  }, [])

  const holdStart = useRef<number | null>(null)
  const placedRef = useRef(placed)
  placedRef.current = placed
  const rebuild = (next: Placement) => {
    const current = placedRef.current
    if (next === current) return
    if (Object.keys(next).length >= Object.keys(current).length) play('rise')
    placedRef.current = next
    setPlaced(next)
    runRef.current = new Running(task.assemble(next, settingsRef.current))
    holdStart.current = null
  }
  const changeSetting = (id: string, value: number) => {
    const next = { ...settingsRef.current, [id]: value }
    settingsRef.current = next
    setSettings(next)
    runRef.current = new Running(task.assemble(placedRef.current, next))
    holdStart.current = null
  }
  const rebuildRef = useRef(rebuild)
  rebuildRef.current = rebuild

  // Opening this chapter counts as reaching it; solving it completes it.
  const onStepRef = useRef(onStep)
  onStepRef.current = onStep
  const onSolvedRef = useRef(onSolved)
  onSolvedRef.current = onSolved
  useEffect(() => {
    onStepRef.current?.(0, false)
  }, [])

  const m = run.metrics()
  const tick = run.flow.tick
  useEffect(() => {
    if (solved || tick === 0) return
    const now = performance.now()
    if (task.check(m, placed, settings, run.flow)) {
      holdStart.current ??= now
      if (now - holdStart.current >= task.holdSeconds * 1000) {
        setSolved(true)
        onSolvedRef.current?.(0)
        onStepRef.current?.(0, true)
        play('success')
      }
    } else {
      holdStart.current = null
    }
  }, [solved, tick, task, m, placed, settings, run])
  // Traffic right now: it can rise and fall during a build.
  const rps = run.flow.all().reduce((sum, n) => sum + (n instanceof Source ? n.rate * TICKS_PER_SECOND : 0), 0)
  const holdProgress = holdStart.current === null ? 0 : Math.min(1, (performance.now() - holdStart.current) / (task.holdSeconds * 1000))

  // Dragging: from the toolbox or off a pad. A press that doesn't move is a
  // tap: in the toolbox it picks the piece for tap-to-place.
  const dragRef = useRef<Drag | null>(null)
  dragRef.current = drag
  const startDrag = (kind: PieceKind, fromPad: string | undefined, e: ReactPointerEvent) => {
    e.preventDefault()
    setDrag({ kind, fromPad, startX: e.clientX, startY: e.clientY, x: e.clientX, y: e.clientY, moved: false })
  }
  const dragging = drag !== null
  useEffect(() => {
    if (!dragging) return
    const move = (e: PointerEvent) => {
      const d = dragRef.current
      if (!d) return
      const moved = d.moved || Math.hypot(e.clientX - d.startX, e.clientY - d.startY) > 6
      setDrag({ ...d, x: e.clientX, y: e.clientY, moved })
      setHoverPad(moved ? padAt(e.clientX, e.clientY) : null)
    }
    const up = (e: PointerEvent) => {
      const d = dragRef.current
      setDrag(null)
      setHoverPad(null)
      if (!d) return
      if (!d.moved) {
        if (d.fromPad === undefined) setSelected((s) => (s === d.kind ? null : d.kind))
        return
      }
      const pad = padAt(e.clientX, e.clientY)
      const current = placedRef.current
      if (pad && canDrop(task, current, pad, d.kind, d.fromPad)) rebuildRef.current(drop(task, current, pad, d.kind, d.fromPad))
      else if (d.fromPad !== undefined) rebuildRef.current(lift(current, d.fromPad)) // dragged off: back to the toolbox
    }
    const cancel = () => {
      setDrag(null)
      setHoverPad(null)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', cancel)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', cancel)
    }
  }, [dragging, task])

  // Tap-to-place: with a piece picked in the toolbox, tapping a pad drops it.
  const tapPad = (padId: string) => {
    if (!selected || !canDrop(task, placed, padId, selected)) return
    const next = drop(task, placed, padId, selected)
    rebuild(next)
    if ((remaining(task, next)[selected] ?? 0) <= 0) setSelected(null)
  }

  const left = remaining(task, placed)
  const activeKind = drag?.moved ? drag.kind : selected

  return (
    <div className="relative h-[calc(100svh-57px)] min-h-[260px] w-full select-none overflow-hidden">
      <div className="absolute inset-0">
        <BuildScene
          task={task}
          run={run}
          placed={placed}
          lastTickAt={lastTickAt}
          dragKind={activeKind}
          hoverPad={hoverPad}
          onPadClick={tapPad}
          onPieceDown={(padId, e) => startDrag(placed[padId], padId, e)}
        />
      </div>

      {/* Top: chapter menu, sound and live numbers. */}
      <div className={`pointer-events-none absolute inset-x-0 top-0 ${short ? 'space-y-1.5 p-2' : 'space-y-2 p-3 sm:space-y-3 sm:p-4'}`}>
        <TopBar chapters={chapters} index={index} doneChapters={doneChapters} onChapter={onChapter} />
        <div className={`flex gap-2 ${compact ? 'no-scrollbar pointer-events-auto -mx-3 overflow-x-auto px-3' : 'flex-wrap'}`}>
          <Chip icon={<ArrowIcon />} title="Traffic" value={`${Math.round(rps)} req/s`} />
          <Chip icon={<CrossIcon />} title="Errors" value={`${m.dropRate.toFixed(0)}%`} bad={m.dropRate > 1} />
          {(task.watch ?? [{ kind: 'busy', key: '', label: 'Busiest server' } as const]).map((w) => {
            if (w.kind === 'latency') {
              const ms = m.latency[w.key] ?? 0
              return <Chip key={w.key} icon={<ClockIcon />} title={w.label} value={`${(ms / 1000).toFixed(2)}s`} bad={ms > w.limitMs} />
            }
            const busy = w.key ? (m.busy[w.key] ?? 0) : m.busiest
            return <Chip key={w.key || 'busiest'} icon={<GaugeIcon />} title={w.label} value={`${Math.round(busy * 100)}%`} bad={busy >= 0.9} />
          })}
        </div>
      </div>

      {/* Bottom: goal, toolbox and navigation. */}
      <div
        className={`pointer-events-none absolute inset-x-0 bottom-0 bg-linear-to-t from-bg via-bg/90 to-transparent ${
          short ? 'px-3 pb-2 pt-6' : 'px-3 pb-4 pt-10 sm:px-4 sm:pb-6 sm:pt-16'
        }`}
      >
        <div className="mx-auto flex max-w-5xl flex-col gap-3 sm:flex-row sm:items-end sm:justify-between sm:gap-5">
          <div className="pointer-events-auto min-w-0">
            <div
              className={`max-w-md rounded-xl border transition ${short ? 'mb-2 px-3 py-2' : 'mb-3 p-3'} ${
                solved ? 'border-fg bg-fg text-bg' : 'border-line bg-bg/80 backdrop-blur'
              }`}
            >
              <div className={`font-mono text-[10px] uppercase tracking-widest opacity-70 ${short ? 'hidden' : ''}`}>
                {solved ? '✓ Built' : 'Goal'}
              </div>
              <div className="mt-1 text-sm font-medium">{solved ? task.win : task.goal}</div>
              {!solved && (
                <div className="mt-2 h-1 overflow-hidden rounded-full bg-line">
                  <div className="h-full rounded-full bg-fg transition-[width]" style={{ width: `${holdProgress * 100}%` }} />
                </div>
              )}
            </div>
            <h2 className={`font-semibold tracking-tight ${short ? 'text-lg' : 'text-xl sm:text-2xl'}`}>{task.title}</h2>
            <p className="mt-1 text-sm text-muted">{selected ? `Now tap a pad to place the ${PIECE_NAMES[selected].toLowerCase()}.` : task.sub}</p>

            {/* The toolbox. touch-none so a finger drag moves the piece
                instead of scrolling the page. */}
            <div className="mt-3 flex flex-wrap gap-2">
              {task.toolbox.map(({ kind }) => {
                const count = left[kind] ?? 0
                return (
                  <button
                    key={kind}
                    disabled={count <= 0}
                    onPointerDown={(e) => count > 0 && startDrag(kind, undefined, e)}
                    aria-pressed={selected === kind}
                    aria-label={`${PIECE_NAMES[kind]}, ${count} left. Drag onto a pad, or tap then tap a pad.`}
                    className={`flex touch-none items-center gap-2 rounded-xl border bg-bg/90 py-1.5 pl-1.5 pr-3 text-sm backdrop-blur transition disabled:opacity-35 ${
                      selected === kind ? 'border-fg ring-1 ring-fg' : 'border-line hover:border-fg'
                    } ${count > 0 ? 'cursor-grab active:cursor-grabbing' : ''}`}
                  >
                    <PieceIcon kind={kind} size={34} />
                    <span>{PIECE_NAMES[kind]}</span>
                    <span className="font-mono text-xs text-muted">×{count}</span>
                  </button>
                )
              })}
              {/* Settings appear once the piece they adjust is on the floor. */}
              {(task.settings ?? [])
                .filter((s) => Object.values(placed).includes(s.when))
                .map((s) => (
                  <div key={s.id} className="flex items-center gap-2">
                    <PieceIcon kind={s.when} size={28} />
                    <Stepper
                      value={settings[s.id]}
                      min={s.min}
                      max={s.max}
                      label={s.label}
                      onChange={(v) => changeSetting(s.id, settings[s.id] + (v > settings[s.id] ? s.step : -s.step))}
                    />
                  </div>
                ))}
            </div>
          </div>

          <div className="pointer-events-auto flex shrink-0 items-center gap-2">
            <button
              onClick={() => onChapter(Math.max(index - 1, 0))}
              className="h-10 w-10 shrink-0 rounded-full border border-line bg-bg/80 text-muted backdrop-blur transition hover:text-fg"
              aria-label="Previous chapter"
            >
              ←
            </button>
            <button
              onClick={lastChapter ? onFinish : () => onChapter(index + 1)}
              className={`h-10 flex-1 rounded-full px-6 text-sm font-medium transition sm:flex-none ${
                solved ? 'animate-pulse bg-fg text-bg hover:opacity-85' : 'border border-line bg-bg/80 text-muted backdrop-blur hover:text-fg'
              }`}
            >
              {lastChapter ? (solved ? 'Finish ✓' : 'Finish') : 'Skip →'}
            </button>
          </div>
        </div>
      </div>

      {/* The piece following the pointer while dragging. */}
      {drag?.moved && (
        <div className="pointer-events-none fixed z-50 -translate-x-1/2 -translate-y-1/2 opacity-90" style={{ left: drag.x, top: drag.y }}>
          <PieceIcon kind={drag.kind} size={64} />
        </div>
      )}
    </div>
  )
}
