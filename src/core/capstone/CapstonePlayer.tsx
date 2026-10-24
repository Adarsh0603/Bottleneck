import { useEffect, useRef, useState } from 'react'
import BuildPlayer from '../build/BuildPlayer'
import type { Placement, Settings } from '../build/types'
import { CHEAT_SHEET, TopBar } from '../chrome'
import { play } from '../sound'
import type { Capstone } from './types'

interface CapstoneProps {
  capstone: Capstone
  chapter: number
  doneChapters: number[]
  onChapter: (index: number) => void
  onCheatSheet?: () => void
  onStep?: (step: number, isLastStep: boolean) => void
  onSolved?: (step: number) => void
  onFinish?: () => void
}

// The board survives moving between stages (each stage is its own screen).
const boards = new Map<string, { placed: Placement; settings: Settings }>()

// A capstone: four stages. Requirements and the final review are paper; the
// two middle stages share one design board.
export default function CapstonePlayer(props: CapstoneProps) {
  const { capstone, chapter } = props
  const chapters = capstone.stages.map((title) => ({ title, level: 'Advanced' as const }))
  const next = () => props.onChapter(Math.min(chapter + 1, chapters.length - 1))

  if (chapter === 1 || chapter === 2) {
    const task = chapter === 1 ? capstone.first : capstone.scale
    const saved = boards.get(capstone.id)
    const pads = new Set(task.pads.map((p) => p.id))
    // Pieces on pads this stage doesn't have are kept for later, not shown.
    const placed = Object.fromEntries(Object.entries(saved?.placed ?? {}).filter(([id]) => pads.has(id)))
    return (
      <BuildPlayer
        task={task}
        chapters={chapters}
        index={chapter}
        doneChapters={props.doneChapters}
        onChapter={props.onChapter}
        onCheatSheet={props.onCheatSheet}
        onStep={props.onStep}
        onSolved={props.onSolved}
        initial={{ placed, settings: saved?.settings ?? {} }}
        onBoard={(p, s) => boards.set(capstone.id, { placed: { ...saved?.placed, ...p }, settings: s })}
        onContinue={next}
        continueText="Next stage →"
      />
    )
  }
  return (
    <Paper chapters={chapters} {...props}>
      {chapter === 0 ? <Estimate {...props} next={next} /> : <Final {...props} />}
    </Paper>
  )
}

// A plain page with the usual top bar, on a faint blueprint grid.
function Paper({
  chapters,
  chapter,
  doneChapters,
  onChapter,
  onCheatSheet,
  children,
}: CapstoneProps & { chapters: { title: string; level: 'Advanced' }[]; children: React.ReactNode }) {
  return (
    <div className="blueprint relative h-[calc(100svh-57px)] min-h-[260px] w-full overflow-y-auto">
      <div className="mx-auto flex min-h-full max-w-2xl flex-col gap-4 p-3 sm:p-4">
        <TopBar
          chapters={chapters}
          index={chapter}
          doneChapters={doneChapters}
          onChapter={onChapter}
          extra={onCheatSheet && { title: CHEAT_SHEET, onOpen: onCheatSheet }}
        />
        {children}
      </div>
    </div>
  )
}

const Label = ({ children }: { children: React.ReactNode }) => (
  <div className="font-mono text-[10px] uppercase tracking-widest text-muted">{children}</div>
)

function Brief({ capstone }: { capstone: Capstone }) {
  return (
    <section className="rounded-2xl border border-line bg-bg/90 p-4 backdrop-blur">
      <Label>{capstone.brief.title}</Label>
      <div className="mt-2 space-y-2 text-sm sm:text-base">
        {capstone.brief.lines.map((l) => (
          <p key={l}>{l}</p>
        ))}
      </div>
    </section>
  )
}

// Stage 1: work out the numbers. One question at a time; a wrong answer
// explains itself, and the right one shows the working.
function Estimate({ capstone, onStep, onSolved, next }: CapstoneProps & { next: () => void }) {
  const { intro, questions } = capstone.estimate
  const [q, setQ] = useState(0)
  const [tried, setTried] = useState<number[]>([])
  const [right, setRight] = useState(false)
  const done = q >= questions.length
  const reported = useRef(false)

  useEffect(() => {
    onStep?.(0, false)
  }, [onStep])
  useEffect(() => {
    if (!done || reported.current) return
    reported.current = true
    onSolved?.(0)
    onStep?.(0, true)
    play('success')
  }, [done, onSolved, onStep])

  const question = questions[Math.min(q, questions.length - 1)]
  const pick = (i: number) => {
    if (right || tried.includes(i)) return
    setTried((t) => [...t, i])
    if (i === question.answer) {
      setRight(true)
      play('right')
    } else play('wrong')
  }
  return (
    <>
      <Brief capstone={capstone} />
      <section className="rounded-2xl border border-line bg-bg/90 p-4 backdrop-blur">
        <Label>Back of the envelope · {Math.min(q + 1, questions.length)} of {questions.length}</Label>
        <p className="mt-2 text-sm text-muted">{intro}</p>
        {done ? (
          <div className="mt-4">
            <p className="text-lg font-semibold tracking-tight">About 12 new links and 1,200 redirects a second, around 1 TB.</p>
            <p className="mt-1 text-sm text-muted">Reads dominate, and the data fits on one machine. Those two facts shape everything next.</p>
            <button onClick={next} className="mt-4 h-10 rounded-full bg-fg px-6 text-sm font-medium text-bg transition hover:opacity-85">
              Next stage →
            </button>
          </div>
        ) : (
          <div className="mt-4">
            <h2 className="text-lg font-semibold tracking-tight sm:text-xl">{question.question}</h2>
            <div className="mt-3 grid gap-2 sm:grid-cols-3">
              {question.options.map((o, i) => {
                const wrong = tried.includes(i) && i !== question.answer
                const correct = right && i === question.answer
                return (
                  <button
                    key={o}
                    onClick={() => pick(i)}
                    disabled={wrong}
                    className={`rounded-xl border px-3 py-3 text-left text-sm transition ${
                      correct ? 'border-fg bg-fg text-bg' : wrong ? 'border-danger text-danger opacity-70' : 'border-line bg-bg hover:border-fg'
                    }`}
                  >
                    {o}
                  </button>
                )
              })}
            </div>
            {tried.length > 0 && !right && <p className="mt-3 text-sm text-danger">Not quite. Try another.</p>}
            {right && (
              <>
                <p className="mt-3 text-sm">{question.why}</p>
                <button
                  onClick={() => {
                    setQ((n) => n + 1)
                    setTried([])
                    setRight(false)
                  }}
                  className="mt-4 h-10 rounded-full bg-fg px-6 text-sm font-medium text-bg transition hover:opacity-85"
                >
                  {q + 1 >= questions.length ? 'Done' : 'Next number →'}
                </button>
              </>
            )}
          </div>
        )}
      </section>
    </>
  )
}

// Stage 4: your design next to a reference design, then what to say about it.
function Final({ capstone, onStep, onFinish }: CapstoneProps) {
  const saved = boards.get(capstone.id)
  const review = capstone.review(saved?.placed ?? {}, saved?.settings ?? {})
  useEffect(() => {
    onStep?.(0, true)
  }, [onStep])
  const matched = review.lines.filter((l) => l.ok).length
  return (
    <>
      <section className="rounded-2xl border border-line bg-bg/90 p-4 backdrop-blur">
        <Label>Your design against a reference</Label>
        <p className="mt-2 text-lg font-semibold tracking-tight">
          {matched} of {review.lines.length} choices match.
        </p>
        <ul className="mt-3 divide-y divide-line">
          {review.lines.map((l) => (
            <li key={l.label} className="py-2.5">
              <div className="flex items-baseline gap-2">
                <span aria-label={l.ok ? 'matches' : 'differs'} className={`font-mono text-xs ${l.ok ? '' : 'text-danger'}`}>
                  {l.ok ? '✓' : '✕'}
                </span>
                <span className="text-sm font-medium">{l.label}</span>
              </div>
              <div className="mt-0.5 grid gap-x-4 pl-5 text-xs text-muted sm:grid-cols-2">
                <span>You: {l.yours}</span>
                <span>Reference: {l.reference}</span>
              </div>
              <p className="mt-1 pl-5 text-xs">{l.why}</p>
            </li>
          ))}
        </ul>
      </section>
      <section className="rounded-2xl border border-line bg-bg/90 p-4 backdrop-blur">
        <Label>Trade-offs to mention</Label>
        <ul className="mt-2 list-disc space-y-1.5 pl-5 text-sm">
          {review.tradeoffs.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
      </section>
      <section className="rounded-2xl border border-line bg-bg/90 p-4 backdrop-blur">
        <Label>The answer, in order</Label>
        <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-sm">
          {review.interview.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ol>
      </section>
      <button
        onClick={onFinish}
        disabled={!onFinish}
        className="mb-2 h-10 self-start rounded-full bg-fg px-6 text-sm font-medium text-bg transition hover:opacity-85 disabled:opacity-30"
      >
        Finish ✓
      </button>
    </>
  )
}
