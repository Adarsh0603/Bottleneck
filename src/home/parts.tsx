import { continueTarget, useProgress } from '../core/progress'
import { navigate } from '../core/router'
import { TOPICS } from '../topics/registry'
import { chapterCounts } from './shared'

export type HomeView = 'map' | 'list'

// "Continue · Load balancing · Scale up →", shown once something is started.
export function ContinueButton({ className = '' }: { className?: string }) {
  const progress = useProgress()
  const resume = continueTarget(progress, chapterCounts)
  const topic = resume && TOPICS.find((t) => t.id === resume.topic)
  if (!resume || !topic) return null

  return (
    <button
      onClick={() => navigate({ page: 'topic', topic: resume.topic, chapter: resume.chapter, step: resume.step })}
      className={`flex w-full max-w-md items-center justify-between gap-4 rounded-2xl bg-fg px-5 py-4 text-left text-bg transition hover:opacity-90 ${className}`}
    >
      <span>
        <span className="block font-mono text-[10px] uppercase tracking-widest opacity-70">Continue</span>
        <span className="mt-0.5 block font-medium">
          {topic.title} · {topic.chapters?.[resume.chapter]}
        </span>
      </span>
      <span aria-hidden>→</span>
    </button>
  )
}

export function ViewToggle({ view, onChange }: { view: HomeView; onChange: (view: HomeView) => void }) {
  return (
    <div className="inline-flex rounded-full border border-line bg-bg/80 p-0.5 font-mono text-xs backdrop-blur" role="group" aria-label="Home view">
      {(['map', 'list'] as const).map((v) => (
        <button
          key={v}
          onClick={() => onChange(v)}
          aria-pressed={view === v}
          className={`rounded-full px-3 py-1 capitalize transition ${view === v ? 'bg-fg text-bg' : 'text-muted hover:text-fg'}`}
        >
          {v}
        </button>
      ))}
    </div>
  )
}
