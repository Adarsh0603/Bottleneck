import { useEffect, useRef, useState } from 'react'
import { shotAt, stateAt } from './chapters'
import { isSoundOn, play, setSoundOn } from './sound'
import type { BaseBeat, Reference, TopicSpec } from './types'

// Plays one chapter of any topic: the scene, captions, live stats, controls,
// practice challenges, sound and navigation. Remounted per chapter (keyed by
// the caller), so each chapter starts with a fresh simulation.
export default function Player<S, Sim, M, B extends BaseBeat<S, Sim, M>>({
  topic,
  index,
  onChapter,
}: {
  topic: TopicSpec<S, Sim, M, B>
  index: number
  onChapter: (index: number) => void
}) {
  const chapters = topic.chapters
  const chapter = chapters[index]
  const [beatIdx, setBeatIdx] = useState(0)
  const [st, setSt] = useState(() => stateAt(chapter, 0))
  const [ramping, setRamping] = useState(!!chapter.beats[0].ramp)
  const [shake, setShake] = useState(0)
  const [solvedBeat, setSolvedBeat] = useState(-1)
  const [sound, setSound] = useState(isSoundOn)
  const [menuOpen, setMenuOpen] = useState(false)

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
    <div className="relative h-[calc(100svh-57px)] min-h-[600px] w-full overflow-hidden">
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
      <div className="pointer-events-none absolute inset-x-0 top-0 space-y-3 p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="pointer-events-auto relative flex items-center gap-2">
            <button
              onClick={() => setMenuOpen((o) => !o)}
              className="flex items-center gap-2 rounded-full border border-line bg-bg/80 px-3 py-1.5 text-sm backdrop-blur transition hover:border-fg"
            >
              <span className="font-mono text-xs text-muted">{String(index + 1).padStart(2, '0')}</span>
              <span className="font-medium">{chapter.title}</span>
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
                      {c.title}
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
            className="pointer-events-auto rounded-full border border-line bg-bg/80 px-3 py-1.5 font-mono text-xs text-muted backdrop-blur transition hover:text-fg"
          >
            Sound {sound ? 'on' : 'off'}
          </button>
        </div>

        <div className="flex flex-wrap gap-2">
          <Stats {...panel} />
        </div>
      </div>

      {beat.sheet && topic.reference && <ReferenceSheet reference={topic.reference} />}

      {/* Bottom: challenge, caption, controls and navigation. */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-linear-to-t from-bg via-bg/90 to-transparent px-4 pb-6 pt-16">
        <div className="mx-auto flex max-w-5xl flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
          <div key={`${index}-${beatIdx}`} className="caption-in pointer-events-auto min-w-0">
            {challenge && (
              <div
                className={`mb-4 max-w-md rounded-xl border p-3 transition ${
                  solved ? 'border-fg bg-fg text-bg' : 'border-line bg-bg/80 backdrop-blur'
                }`}
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
            <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">{beat.caption}</h2>
            {beat.sub && <p className="mt-1 text-muted">{beat.sub}</p>}
            <Controls {...panel} />
          </div>

          <div className="pointer-events-auto flex shrink-0 items-center gap-2">
            <button
              onClick={() => go(beatIdx - 1)}
              disabled={beatIdx === 0 && index === 0}
              className="h-10 w-10 rounded-full border border-line bg-bg/80 text-muted backdrop-blur transition hover:text-fg disabled:opacity-30"
              aria-label="Previous step"
            >
              ←
            </button>
            <button
              onClick={() => go(beatIdx + 1)}
              disabled={lastBeat && lastChapter}
              className={`h-10 rounded-full px-6 text-sm font-medium transition disabled:opacity-30 ${
                challenge && !solved
                  ? 'border border-line bg-bg/80 text-muted backdrop-blur hover:text-fg'
                  : 'bg-fg text-bg hover:opacity-85'
              } ${solved ? 'animate-pulse' : ''}`}
            >
              {lastBeat && lastChapter
                ? 'The end'
                : challenge && !solved
                  ? 'Skip →'
                  : lastBeat
                    ? `Next: ${chapters[index + 1].title} →`
                    : 'Next →'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function ReferenceSheet({ reference }: { reference: Reference }) {
  return (
    <div className="caption-in absolute right-4 top-32 bottom-56 z-10 w-[min(26rem,calc(100%-2rem))] space-y-3 overflow-y-auto rounded-2xl border border-line bg-bg/90 p-4 backdrop-blur-md">
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
