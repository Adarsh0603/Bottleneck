import { useEffect, useState } from 'react'
import { recordSolved, recordStep } from './core/progress'
import { navigate, replaceRoute, useRoute } from './core/router'
import Home from './Home'
import { TOPICS, type TopicEntry } from './topics/registry'

function useTheme() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'))
  const toggle = () => {
    const next = !dark
    setDark(next)
    document.documentElement.classList.toggle('dark', next)
    try {
      localStorage.setItem('theme', next ? 'dark' : 'light')
    } catch {
      // Storage can be blocked; the toggle still works for this visit.
    }
  }
  return { dark, toggle }
}

export default function App() {
  const { dark, toggle } = useTheme()
  const route = useRoute()

  // Unknown or not-yet-built topics fall back to the home page.
  const topic = route.page === 'topic' ? TOPICS.find((t) => t.id === route.topic && t.Play) : undefined

  useEffect(() => {
    document.title = topic ? `${topic.title} · Bottleneck` : 'Bottleneck · Learn system design by breaking things'
  }, [topic])

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 h-[57px] border-b border-line bg-bg/70 backdrop-blur-md">
        <div className="flex h-full items-center justify-between gap-3 px-4">
          <div className="flex min-w-0 items-center gap-3">
            <a href="#/" className="flex items-center gap-3" aria-label="Bottleneck home">
              <img src="/favicon.svg" alt="" className="h-6 w-6" />
              <span className="font-semibold tracking-tight">Bottleneck</span>
            </a>
            {topic && (
              <>
                <span className="text-line">/</span>
                <span className="truncate text-sm text-muted">{topic.title}</span>
              </>
            )}
          </div>
          <button
            onClick={toggle}
            className="rounded-full border border-line px-3 py-1 font-mono text-xs text-muted transition hover:text-fg"
            aria-label="Toggle theme"
          >
            {dark ? 'Light' : 'Dark'}
          </button>
        </div>
      </header>
      {topic && route.page === 'topic' ? (
        <TopicView topic={topic} chapter={route.chapter} step={route.step} />
      ) : (
        <Home />
      )}
    </div>
  )
}

function TopicView({ topic, chapter, step }: { topic: TopicEntry; chapter: number; step: number }) {
  const Play = topic.Play!
  const ch = Math.min(chapter, (topic.chapters?.length ?? 1) - 1)

  return (
    <Play
      key={`${topic.id}-${ch}-${step}`}
      chapter={ch}
      step={step}
      onChapter={(i) => navigate({ page: 'topic', topic: topic.id, chapter: i, step: 0 })}
      onStep={(s, isLast) => {
        recordStep(topic.id, ch, s, isLast)
        replaceRoute({ page: 'topic', topic: topic.id, chapter: ch, step: s })
      }}
      onSolved={(s) => recordSolved(topic.id, ch, s)}
    />
  )
}
