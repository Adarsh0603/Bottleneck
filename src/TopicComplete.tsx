import { useEffect } from 'react'
import { topicProgress, useProgress } from './core/progress'
import { navigate } from './core/router'
import { play } from './core/sound'
import { nextAfter, openTopic, solvedCount, statusOf } from './home/shared'
import type { TopicEntry } from './topics/registry'

// Shown after "Finish" on a topic's last step: a clear "you completed this"
// moment, or what's still left if some chapters were skipped.
export default function TopicComplete({ topic, onClose }: { topic: TopicEntry; onClose: () => void }) {
  const progress = useProgress()
  const p = topicProgress(progress, topic.id)
  const chapters = topic.chapters ?? []
  const complete = statusOf(progress, topic) === 'done'
  const missing = chapters.map((title, i) => ({ title, i })).filter((c) => !p.done.includes(c.i))
  const solved = solvedCount(progress, topic)
  const totalChallenges = topic.challenges?.length ?? 0
  const next = complete ? nextAfter(progress, topic) : undefined

  useEffect(() => {
    if (complete) play('success')
  }, [complete])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="fixed inset-x-0 bottom-0 top-[57px] z-40 grid place-items-center bg-bg/70 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label={`${topic.title} ${complete ? 'complete' : 'progress'}`}>
      <div className="caption-in w-full max-w-md rounded-2xl border border-fg bg-bg p-6 text-center shadow-xl">
        <div
          className={`mx-auto grid h-16 w-16 place-items-center rounded-full ${
            complete ? 'bg-fg text-3xl text-bg' : 'border-2 border-dashed border-line font-mono text-base text-muted'
          }`}
          aria-hidden
        >
          {complete ? '✓' : `${p.done.length}/${chapters.length}`}
        </div>

        <div className="mt-5 font-mono text-[11px] uppercase tracking-widest text-muted">{complete ? 'Topic complete' : 'Almost there'}</div>
        <h2 className="mt-1 text-2xl font-semibold tracking-tight">{topic.title}</h2>

        <div className="mt-5 grid grid-cols-2 gap-3">
          <Count label="Chapters" value={p.done.length} total={chapters.length} />
          <Count label="Challenges solved" value={solved} total={totalChallenges} />
        </div>

        {!complete && (
          <div className="mt-5 text-left">
            <div className="mb-2 text-sm text-muted">Finish these to complete the topic:</div>
            <ul className="space-y-1">
              {missing.map((c) => (
                <li key={c.i}>
                  <button
                    onClick={() => openTopic(progress, topic, c.i)}
                    className="flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left text-sm transition hover:bg-subtle"
                  >
                    <span className="font-mono text-xs text-muted">{String(c.i + 1).padStart(2, '0')}</span>
                    <span className="flex-1">{c.title}</span>
                    <span className="text-muted">→</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-center">
          <button
            onClick={() => navigate({ page: 'home' })}
            className="rounded-full border border-line px-5 py-2.5 text-sm transition hover:border-fg"
          >
            All topics
          </button>
          {complete && next && (
            <button
              onClick={() => openTopic(progress, next)}
              className="rounded-full bg-fg px-5 py-2.5 text-sm font-medium text-bg transition hover:opacity-85"
            >
              Next: {next.title} →
            </button>
          )}
          {complete && !next && (
            <span className="self-center px-2 text-sm text-muted">More topics are on the way.</span>
          )}
        </div>
      </div>
    </div>
  )
}

function Count({ label, value, total }: { label: string; value: number; total: number }) {
  const full = total > 0 && value >= total
  return (
    <div className={`rounded-xl border p-3 ${full ? 'border-fg' : 'border-line'}`}>
      <div className="text-[11px] font-medium text-muted">{label}</div>
      <div className="mt-0.5 font-mono text-lg tabular-nums">
        {value} / {total}
        {full && <span className="ml-1.5">✓</span>}
      </div>
    </div>
  )
}
