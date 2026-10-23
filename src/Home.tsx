import { continueTarget, resetProgress, topicProgress, useProgress } from './core/progress'
import { navigate } from './core/router'
import { TOPICS, TRACKS, type TopicEntry } from './topics/registry'

const built = TOPICS.filter((t) => t.Play && t.chapters)
const chapterCounts = Object.fromEntries(built.map((t) => [t.id, t.chapters!.length]))

export default function Home() {
  const progress = useProgress()
  const resume = continueTarget(progress, chapterCounts)
  const resumeTopic = resume && TOPICS.find((t) => t.id === resume.topic)

  // The first built topic, in recommended order, that isn't finished yet.
  const next = built.find((t) => topicProgress(progress, t.id).done.length < t.chapters!.length)

  // Pick up where the learner left off; a finished topic starts over for review.
  const open = (t: TopicEntry) => {
    const p = topicProgress(progress, t.id)
    const finished = p.done.length >= t.chapters!.length
    const last = finished ? undefined : p.last
    navigate({ page: 'topic', topic: t.id, chapter: last?.chapter ?? 0, step: last?.step ?? 0 })
  }

  return (
    <main className="mx-auto max-w-6xl px-4 py-10 sm:py-14">
      <section className="max-w-2xl">
        <div className="font-mono text-[11px] uppercase tracking-widest text-muted">System design, visually</div>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">Learn system design by breaking things.</h1>
        <p className="mt-3 text-muted">
          Watch systems overload, fail and recover, then fix them yourself. From your first server to distributed
          consensus.
        </p>

        {resume && resumeTopic && (
          <button
            onClick={() => navigate({ page: 'topic', topic: resume.topic, chapter: resume.chapter, step: resume.step })}
            className="mt-6 flex w-full max-w-md items-center justify-between gap-4 rounded-2xl bg-fg px-5 py-4 text-left text-bg transition hover:opacity-90"
          >
            <span>
              <span className="block font-mono text-[10px] uppercase tracking-widest opacity-70">Continue</span>
              <span className="mt-0.5 block font-medium">
                {resumeTopic.title} · {resumeTopic.chapters?.[resume.chapter]}
              </span>
            </span>
            <span aria-hidden>→</span>
          </button>
        )}
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
                <TopicCard key={t.id} topic={t} number={TOPICS.indexOf(t) + 1} isNext={t === next} onOpen={() => open(t)} />
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

function TopicCard({ topic, number, isNext, onOpen }: { topic: TopicEntry; number: number; isNext: boolean; onOpen: () => void }) {
  const progress = useProgress()
  const label = String(number).padStart(2, '0')

  if (!topic.Play || !topic.chapters) {
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
  const done = p.done.length
  const finished = done >= total

  return (
    <button
      onClick={onOpen}
      className={`group flex flex-col rounded-2xl border bg-bg p-4 text-left transition hover:border-fg ${
        isNext ? 'border-fg' : 'border-line'
      }`}
    >
      <div className="flex items-center justify-between font-mono text-xs text-muted">
        <span>{label}</span>
        {finished ? (
          <span className="rounded-full border border-fg px-2 py-0.5 text-[10px] uppercase tracking-widest text-fg">✓ Done</span>
        ) : isNext ? (
          <span className="rounded-full bg-fg px-2 py-0.5 text-[10px] uppercase tracking-widest text-bg">Next</span>
        ) : null}
      </div>
      <h3 className="mt-3 font-medium">{topic.title}</h3>
      <p className="mt-1 flex-1 text-sm leading-6 text-muted">{topic.pitch}</p>

      <div className="mt-4 flex gap-1" aria-label={`${done} of ${total} chapters done`}>
        {topic.chapters.map((title, i) => (
          <span
            key={title}
            title={title}
            className={`h-1 flex-1 rounded-full ${p.done.includes(i) ? 'bg-fg' : 'bg-line'}`}
          />
        ))}
      </div>
      <div className="mt-2 flex justify-between font-mono text-[11px] text-muted">
        <span>
          {done} / {total} chapters
        </span>
        <span className="transition group-hover:text-fg">{done === 0 && !p.last ? 'Start →' : finished ? 'Review →' : 'Continue →'}</span>
      </div>
    </button>
  )
}
