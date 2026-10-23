import { useEffect, useRef, useState } from 'react'
import { shotAt, stateAt } from './chapters'
import { isSoundOn, play, setSoundOn } from './sound'
import { COMPACT, SHORT, useMedia } from './useMedia'
import type { BaseBeat, Reference, TopicSpec } from './types'

// Plays one chapter of any topic: the scene, captions, live stats, controls,
// practice challenges, sound and navigation. Remounted per chapter (keyed by
// the caller), so each chapter starts with a fresh simulation.
export default function Player<S, Sim, M, B extends BaseBeat<S, Sim, M>>({
  topic,
  index,
  startStep = 0,
  doneChapters = [],
  onChapter,
  onStep,
  onSolved,
  onFinish,
}: {
  topic: TopicSpec<S, Sim, M, B>
  index: number
  startStep?: number
  doneChapters?: number[]
  onChapter: (index: number) => void
  onStep?: (step: number, isLastStep: boolean) => void
  onSolved?: (step: number) => void
  onFinish?: () => void
}) {
  const chapters = topic.chapters
  const chapter = chapters[index]
  const first = Math.min(Math.max(0, startStep), chapter.beats.length - 1)
  const [beatIdx, setBeatIdx] = useState(first)
  const [st, setSt] = useState(() => stateAt(chapter, first))
  const [ramping, setRamping] = useState(!!chapter.beats[first].ramp)
  const [shake, setShake] = useState(0)
  const [solvedBeat, setSolvedBeat] = useState(-1)
  const [sound, setSound] = useState(isSoundOn)
  const [menuOpen, setMenuOpen] = useState(false)
  // Small screens can fold the caption area down to just the headline. Short
  // screens (a phone on its side) start folded, since there's so little room.
  const compact = useMedia(COMPACT)
  const short = useMedia(SHORT)
  const [foldedPref, setFolded] = useState(() => window.matchMedia(SHORT).matches)
  const folded = compact && foldedPref

  const stRef = useRef(st)
  stRef.current = st
  const runtime = topic.useRuntime(stRef)
  const { sim, metrics, tick } = runtime
  const { sync, feedback, dropCount } = topic

  const beat = chapter.beats[beatIdx]
  const challenge = beat.challenge
  const solved = solvedBeat === beatIdx
  const lastBeat = beatIdx === chapter.beats.length - 1
  const lastChapter = index === chapters.length - 1

  const holdStart = useRef<number | null>(null)

  const go = (i: number) => {
    if (i >= chapter.beats.length) return onChapter(Math.min(index + 1, chapters.length - 1))
    if (i < 0) return onChapter(Math.max(index - 1, 0))
    setBeatIdx(i)
    setSt(stateAt(chapter, i))
    setRamping(!!chapter.beats[i].ramp)
    holdStart.current = null
  }

  useEffect(() => {
    sync(sim, st)
  }, [sync, sim, st])

  // Report each step reached, for saved progress and the address bar. Kept in
  // a ref so a new callback each render doesn't re-report the same step.
  const onStepRef = useRef(onStep)
  onStepRef.current = onStep
  const stepCount = chapter.beats.length
  useEffect(() => {
    onStepRef.current?.(beatIdx, beatIdx === stepCount - 1)
  }, [beatIdx, stepCount])

  // Shake and sound when something breaks; a rising tone when something arrives.
  const prev = useRef(st)
  useEffect(() => {
    const p = prev.current
    prev.current = st
    const f = feedback(p, st)
    if (f.crash) {
      setShake((k) => k + 1)
      play('crash')
    }
    if (f.rise) play('rise')
  }, [feedback, st])

  // Beats that change state on a timer, e.g. traffic climbing.
  const ramp = beat.ramp
  useEffect(() => {
    if (!ramping || !ramp) return
    if (!ramp.next(st)) {
      setRamping(false)
      return
    }
    const id = setTimeout(() => setSt((p) => ramp.next(p) ?? p), ramp.everyMs)
    return () => clearTimeout(id)
  }, [ramping, ramp, st])

  // Runs after every tick: drop sounds, and checking the challenge goal is
  // held long enough.
  const lastDrops = useRef(0)
  const lastDropSound = useRef(0)
  const onSolvedRef = useRef(onSolved)
  onSolvedRef.current = onSolved
  useEffect(() => {
    const now = performance.now()
    const drops = dropCount(sim)
    if (drops > lastDrops.current && now - lastDropSound.current > 220) {
      play('drop')
      lastDropSound.current = now
    }
    lastDrops.current = drops

    if (!challenge || solved || tick === 0) return
    if (challenge.check({ m: metrics, st, sim })) {
      holdStart.current ??= now
      if (now - holdStart.current >= challenge.holdSeconds * 1000) {
        setSolvedBeat(beatIdx)
        onSolvedRef.current?.(beatIdx)
        play('success')
      }
    } else {
      holdStart.current = null
    }
  }, [dropCount, sim, tick, challenge, solved, st, beatIdx, metrics])

  const holdProgress =
    challenge && holdStart.current !== null
      ? Math.min(1, (performance.now() - holdStart.current) / (challenge.holdSeconds * 1000))
      : 0

  const update = (change: (p: S) => Partial<S>) => setSt((p) => ({ ...p, ...change(p) }))
  const panel = { st, sim, m: metrics, beat, update, stopRamp: () => setRamping(false) }
  const { Scene, Stats, Controls } = topic

  return (
    <div className="relative h-[calc(100svh-57px)] min-h-[260px] w-full overflow-hidden">
      <div className="absolute inset-0">
        <Scene
          simRef={runtime.simRef}
          lastTickAt={runtime.lastTickAt}
          st={st}
          beat={beat}
          shot={shotAt(chapter, beatIdx)}
          shake={shake}
          update={update}
        />
      </div>

      {/* Top: chapter menu, sound and live numbers. */}
      <div
        className={`pointer-events-none absolute inset-x-0 top-0 ${short ? 'space-y-1.5 p-2' : 'space-y-2 p-3 sm:space-y-3 sm:p-4'}`}
      >
        <div className="flex items-center justify-between gap-3">
          <div className="pointer-events-auto relative flex min-w-0 items-center gap-2">
            <button
              onClick={() => setMenuOpen((o) => !o)}
              className="flex min-w-0 items-center gap-2 rounded-full border border-line bg-bg/80 px-3 py-1.5 text-sm backdrop-blur transition hover:border-fg"
            >
              <span className="font-mono text-xs text-muted">{String(index + 1).padStart(2, '0')}</span>
              <span className="truncate font-medium">{chapter.title}</span>
              <span className="text-muted">▾</span>
            </button>
            <span className="hidden rounded-full border border-line bg-bg/80 px-2 py-0.5 font-mono text-[10px] uppercase tracking-widest text-muted backdrop-blur sm:inline">
              {chapter.level}
            </span>
            {menuOpen && (
              <ol className="absolute left-0 top-full z-20 mt-2 w-60 overflow-hidden rounded-xl border border-line bg-bg shadow-lg">
                {chapters.map((c, i) => (
                  <li key={c.title}>
                    <button
                      onClick={() => {
                        setMenuOpen(false)
                        onChapter(i)
                      }}
                      className={`flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm transition hover:bg-subtle ${
                        i === index ? 'font-medium' : 'text-muted'
                      }`}
                    >
                      <span className="font-mono text-xs">{String(i + 1).padStart(2, '0')}</span>
                      <span className="flex-1">{c.title}</span>
                      {doneChapters.includes(i) && (
                        <span className="font-mono text-xs text-fg" aria-label="done">
                          ✓
                        </span>
                      )}
                    </button>
                  </li>
                ))}
              </ol>
            )}
          </div>
          <button
            onClick={() => {
              setSoundOn(!sound)
              setSound(!sound)
            }}
            className="pointer-events-auto shrink-0 rounded-full border border-line bg-bg/80 px-3 py-1.5 font-mono text-xs text-muted backdrop-blur transition hover:text-fg"
          >
            Sound {sound ? 'on' : 'off'}
          </button>
        </div>

        {/* Small screens: one row that scrolls sideways (short ones drop the
            labels too). Larger screens: wraps. */}
        <div
          className={`flex gap-2 ${
            compact
              ? `no-scrollbar pointer-events-auto -mx-3 overflow-x-auto px-3 ${short ? '[&_.chip-title]:hidden' : ''}`
              : 'flex-wrap'
          }`}
        >
          <Stats {...panel} />
        </div>
      </div>

      {beat.sheet && topic.reference && <ReferenceSheet reference={topic.reference} />}

      {/* Bottom: challenge, caption, controls and navigation. */}
      {/* Phones can fold this down to just the caption, to see more of the scene. */}
      <div
        className={`pointer-events-none absolute inset-x-0 bottom-0 bg-linear-to-t from-bg via-bg/90 to-transparent ${
          short ? 'px-3 pb-2 pt-6' : 'px-3 pb-4 pt-10 sm:px-4 sm:pb-6 sm:pt-16'
        }`}
      >
        <div className="mx-auto flex max-w-5xl flex-col gap-3 sm:flex-row sm:items-end sm:justify-between sm:gap-5">
          <div key={`${index}-${beatIdx}`} className="caption-in pointer-events-auto min-w-0">
            {challenge && (
              <div
                className={`mb-3 max-w-md rounded-xl border p-3 transition sm:mb-4 ${
                  solved ? 'border-fg bg-fg text-bg' : 'border-line bg-bg/80 backdrop-blur'
                } ${folded ? 'hidden' : ''}`}
              >
                <div className="font-mono text-[10px] uppercase tracking-widest opacity-70">
                  {solved ? '✓ Solved' : 'Challenge'}
                </div>
                <div className="mt-1 text-sm font-medium">{solved ? challenge.win : challenge.goal}</div>
                {!solved && (
                  <div className="mt-2 h-1 overflow-hidden rounded-full bg-line">
                    <div className="h-full rounded-full bg-fg transition-[width]" style={{ width: `${holdProgress * 100}%` }} />
                  </div>
                )}
              </div>
            )}
            <h2 className={`font-semibold tracking-tight ${short ? 'text-lg' : 'text-xl sm:text-3xl'}`}>{beat.caption}</h2>
            <div className={folded ? 'hidden' : ''}>
              {beat.sub && <p className="mt-1 text-sm text-muted sm:text-base">{beat.sub}</p>}
              <Controls {...panel} />
            </div>
          </div>

          <div className="pointer-events-auto flex shrink-0 items-center gap-2">
            <button
              onClick={() => go(beatIdx - 1)}
              disabled={beatIdx === 0 && index === 0}
              className="h-10 w-10 shrink-0 rounded-full border border-line bg-bg/80 text-muted backdrop-blur transition hover:text-fg disabled:opacity-30"
              aria-label="Previous step"
            >
              ←
            </button>
            {compact && (
              <button
                onClick={() => setFolded(!folded)}
                className="h-10 w-10 shrink-0 rounded-full border border-line bg-bg/80 text-muted backdrop-blur transition hover:text-fg"
                aria-label={folded ? 'Show details' : 'Hide details'}
                aria-expanded={!folded}
              >
                {folded ? '▴' : '▾'}
              </button>
            )}
            {lastBeat && lastChapter ? (
              <button
                onClick={onFinish}
                disabled={!onFinish}
                className="h-10 flex-1 rounded-full bg-fg px-6 text-sm font-medium text-bg transition hover:opacity-85 disabled:opacity-30 sm:flex-none"
              >
                Finish ✓
              </button>
            ) : (
              <button
                onClick={() => go(beatIdx + 1)}
                className={`h-10 flex-1 truncate rounded-full px-6 text-sm font-medium transition sm:flex-none ${
                  challenge && !solved
                    ? 'border border-line bg-bg/80 text-muted backdrop-blur hover:text-fg'
                    : 'bg-fg text-bg hover:opacity-85'
                } ${solved ? 'animate-pulse' : ''}`}
              >
                {challenge && !solved ? 'Skip →' : lastBeat ? `Next: ${chapters[index + 1].title} →` : 'Next →'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function ReferenceSheet({ reference }: { reference: Reference }) {
  return (
    <div className="caption-in absolute inset-x-3 top-16 bottom-40 z-10 space-y-3 overflow-y-auto rounded-2xl border border-line bg-bg/95 p-4 backdrop-blur-md sm:inset-x-auto sm:right-4 sm:top-32 sm:bottom-56 sm:w-[min(26rem,calc(100%-2rem))]">
      <div className="rounded-xl border border-fg p-4">
        <div className="mb-2 font-mono text-[10px] uppercase tracking-widest text-muted">In an interview</div>
        <ul className="list-disc space-y-1.5 pl-5 text-sm">
          {reference.interview.map((i) => (
            <li key={i}>{i}</li>
          ))}
        </ul>
      </div>
      {reference.cards.map((a) => (
        <div key={a.title} className="rounded-xl border border-line p-4">
          <h3 className="text-sm font-medium">{a.title}</h3>
          <p className="mt-1 text-sm leading-6 text-muted">{a.body}</p>
        </div>
      ))}
    </div>
  )
}
