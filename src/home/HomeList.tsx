import { resetProgress, topicProgress, useProgress } from '../core/progress'
import { TOPICS, TRACKS, type TopicEntry } from '../topics/registry'
import { ContinueButton, ViewToggle, type HomeView } from './parts'
import { actionLabel, nextTopic, openTopic, solvedCount, statusOf, topicNumber } from './shared'

export default function HomeList({ onView }: { onView: (view: HomeView) => void }) {
  const progress = useProgress()
  const next = nextTopic(progress)

  return (
    <main className="mx-auto max-w-6xl px-4 py-10 sm:py-14">
      <div className="mb-8 flex justify-end">
        <ViewToggle view="list" onChange={onView} />
      </div>

      <section className="max-w-2xl">
        <div className="font-mono text-[11px] uppercase tracking-widest text-muted">System design, visually</div>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">Learn system design by breaking things.</h1>
        <p className="mt-3 text-muted">
          Watch systems overload, fail and recover, then fix them yourself. From your first server to distributed
          consensus.
        </p>
        <ContinueButton className="mt-6" />
      </section>

      {TRACKS.map((track) => {
        const topics = TOPICS.filter((t) => t.track === track.id)
        return (
          <section key={track.id} className="mt-12">
            <div className="mb-4 flex items-baseline gap-3">
              <h2 className="text-lg font-semibold tracking-tight">{track.title}</h2>
              <span className="rounded-full border border-line px-2 py-0.5 font-mono text-[10px] uppercase tracking-widest text-muted">
                {track.level}
              </span>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {topics.map((t) => (
                <TopicCard key={t.id} topic={t} isNext={t === next} onOpen={() => openTopic(progress, t)} />
              ))}
            </div>
          </section>
        )
      })}

      <footer className="mt-16 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-6 text-xs text-muted">
        <span>Progress is saved in this browser only.</span>
        {Object.keys(progress).length > 0 && (
          <button
            onClick={() => {
              if (window.confirm('Reset all progress? This can’t be undone.')) resetProgress()
            }}
            className="font-mono underline-offset-4 transition hover:text-fg hover:underline"
          >
            Reset progress
          </button>
        )}
      </footer>
    </main>
  )
}

function TopicCard({ topic, isNext, onOpen }: { topic: TopicEntry; isNext: boolean; onOpen: () => void }) {
  const progress = useProgress()
  const status = statusOf(progress, topic)
  const label = topicNumber(topic)

  if (status === 'soon' || !topic.chapters) {
    return (
      <div className="rounded-2xl border border-dashed border-line p-4">
        <div className="flex items-center justify-between font-mono text-xs text-muted">
          <span>{label}</span>
          <span className="rounded-full border border-line px-2 py-0.5 text-[10px] uppercase tracking-widest">Soon</span>
        </div>
        <h3 className="mt-3 font-medium text-muted">{topic.title}</h3>
        <p className="mt-1 text-sm leading-6 text-muted">{topic.pitch}</p>
      </div>
    )
  }

  const p = topicProgress(progress, topic.id)
  const total = topic.chapters.length

  return (
    <button
      onClick={onOpen}
      className={`group flex flex-col rounded-2xl border bg-bg p-4 text-left transition hover:border-fg ${
        isNext || status === 'done' ? 'border-fg' : 'border-line'
      }`}
    >
      <div className="flex items-center justify-between font-mono text-xs text-muted">
        <span>{label}</span>
        {status === 'done' ? (
          <span className="rounded-full bg-fg px-2 py-0.5 text-[10px] uppercase tracking-widest text-bg">✓ Completed</span>
        ) : isNext ? (
          <span className="rounded-full bg-fg px-2 py-0.5 text-[10px] uppercase tracking-widest text-bg">Next</span>
        ) : status === 'started' ? (
          <span className="rounded-full border border-fg px-2 py-0.5 text-[10px] uppercase tracking-widest text-fg">In progress</span>
        ) : null}
      </div>
      <h3 className="mt-3 font-medium">{topic.title}</h3>
      <p className="mt-1 flex-1 text-sm leading-6 text-muted">{topic.pitch}</p>

      <div className="mt-4 flex gap-1" aria-label={`${p.done.length} of ${total} chapters done`}>
        {topic.chapters.map((title, i) => (
          <span key={title} title={title} className={`h-1 flex-1 rounded-full ${p.done.includes(i) ? 'bg-fg' : 'bg-line'}`} />
        ))}
      </div>
      <div className="mt-2 flex justify-between font-mono text-[11px] text-muted">
        <span>
          {p.done.length} / {total} chapters
        </span>
        <span>
          {solvedCount(progress, topic)} / {topic.challenges?.length ?? 0} challenges
        </span>
      </div>
      <div className="mt-3 text-right font-mono text-[11px] text-muted transition group-hover:text-fg">{actionLabel(status)} →</div>
    </button>
  )
}
