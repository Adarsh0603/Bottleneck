import { useState } from 'react'
import { Advanced, ChoosingServer, Failures, OneServer, ScaleOut, ScaleUp, TrafficGrows } from './chapters'

const CHAPTERS = [
  { title: 'One server', heading: 'It starts with one server', level: 'Beginner', Component: OneServer },
  { title: 'Traffic grows', heading: 'What happens when traffic grows', level: 'Beginner', Component: TrafficGrows },
  { title: 'Scale up', heading: 'Buy a bigger machine', level: 'Beginner', Component: ScaleUp },
  { title: 'Scale out', heading: 'Many servers, one address', level: 'Intermediate', Component: ScaleOut },
  { title: 'Algorithms', heading: 'Choosing the right server', level: 'Intermediate', Component: ChoosingServer },
  { title: 'Failures', heading: 'When servers fail', level: 'Intermediate', Component: Failures },
  { title: 'Advanced', heading: 'Beyond the basics', level: 'Advanced', Component: Advanced },
]

export default function LoadBalancerCourse() {
  const [index, setIndex] = useState(0)
  const chapter = CHAPTERS[index]
  const { Component } = chapter

  const go = (i: number) => {
    setIndex(i)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  return (
    <div>
      <nav className="-mx-4 mb-10 overflow-x-auto px-4" aria-label="Chapters">
        <ol className="flex min-w-max gap-1 border-b border-line">
          {CHAPTERS.map((c, i) => (
            <li key={c.title}>
              <button
                onClick={() => go(i)}
                className={`-mb-px flex items-center gap-2 border-b-2 px-3 py-2.5 text-sm transition ${
                  i === index ? 'border-fg text-fg' : 'border-transparent text-muted hover:text-fg'
                }`}
              >
                <span className="font-mono text-xs">{String(i + 1).padStart(2, '0')}</span>
                {c.title}
              </button>
            </li>
          ))}
        </ol>
      </nav>

      <header className="mb-8">
        <div className="flex items-center gap-3 font-mono text-[11px] uppercase tracking-widest text-muted">
          <span>
            Chapter {index + 1} / {CHAPTERS.length}
          </span>
          <span className="rounded-full border border-line px-2 py-0.5">{chapter.level}</span>
        </div>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">{chapter.heading}</h1>
      </header>

      <Component key={index} />

      <footer className="mt-14 flex items-center justify-between gap-4 border-t border-line pt-6">
        {index > 0 ? (
          <button onClick={() => go(index - 1)} className="text-left text-sm text-muted transition hover:text-fg">
            ← {CHAPTERS[index - 1].title}
          </button>
        ) : (
          <span />
        )}
        {index < CHAPTERS.length - 1 && (
          <button
            onClick={() => go(index + 1)}
            className="rounded-full bg-fg px-5 py-2.5 text-sm font-medium text-bg transition hover:opacity-85"
          >
            Next: {CHAPTERS[index + 1].title} →
          </button>
        )}
      </footer>
    </div>
  )
}
