import { useState } from 'react'
import Board from './Board'
import type { Intro } from './types'

// The first thing a project shows: a small system already working, and a
// caption that walks along it one piece at a time.
export default function IntroScene({ intro, onDone }: { intro: Intro; onDone: () => void }) {
  const [step, setStep] = useState(0)
  const s = intro.steps[step]
  const last = step === intro.steps.length - 1

  return (
    <section className="rounded-2xl border border-line bg-bg/90 backdrop-blur">
      <Board task={intro.task} at={s.at} label={s.label} className="h-[60svh] min-h-[280px] rounded-t-2xl" />
      <div className="flex flex-col gap-3 border-t border-line p-4">
        <p key={step} className="text-lg font-semibold tracking-tight sm:text-xl">
          {s.say}
        </p>
        <div className="flex items-center gap-3">
          {step > 0 && (
            <button
              onClick={() => setStep(step - 1)}
              className="h-10 rounded-full border border-line px-5 text-sm font-medium transition hover:border-fg"
            >
              ← Back
            </button>
          )}
          <button
            onClick={() => (last ? onDone() : setStep(step + 1))}
            className="h-10 rounded-full bg-fg px-6 text-sm font-medium text-bg transition hover:opacity-85"
          >
            {last ? intro.start : 'Next →'}
          </button>
          <div className="flex gap-1.5" aria-hidden>
            {intro.steps.map((_, i) => (
              <span key={i} className={`h-1.5 w-1.5 rounded-full ${i === step ? 'bg-fg' : 'bg-line'}`} />
            ))}
          </div>
          {!last && (
            <button onClick={onDone} className="ml-auto text-xs text-muted underline-offset-2 hover:underline">
              Skip
            </button>
          )}
        </div>
      </div>
    </section>
  )
}
