import { TOPICS } from '../topics/registry'
import { conceptOf, isBuilt, PROJECTS, TIER_NAMES, type Project } from './projects'
import { openTopic, type ProjectState } from './shared'

const STATE_TEXT: Record<ProjectState, string> = { done: 'Built', next: 'Next on the road', fog: 'Under mist' }

// The chosen project: what it is, which concepts it needs, and a way in.
// Every concept opens at any time; nothing here is locked.
export default function ProjectCard({ project, state }: { project: Project; state: ProjectState }) {
  const built = isBuilt(project)
  const topic = TOPICS.find((t) => t.id === project.id)
  return (
    <section className="mt-4 rounded-2xl border border-line bg-bg p-5" aria-live="polite">
      <div className="font-mono text-[11px] uppercase tracking-widest text-muted">
        {TIER_NAMES[project.tier]} · project {PROJECTS.indexOf(project) + 1} ·{' '}
        <span className={state === 'next' ? 'text-danger' : ''}>{STATE_TEXT[state]}</span>
      </div>
      <h2 className="mt-1 text-xl font-semibold tracking-tight">{project.name}</h2>
      {topic?.pitch && <p className="mt-1 text-sm text-muted">{topic.pitch}</p>}

      <div className="mt-4 font-mono text-[11px] uppercase tracking-widest text-muted">Concepts you will use</div>
      <div className="mt-2 flex flex-wrap gap-2">
        {project.needs.map((name) => {
          const c = conceptOf(name)
          const lesson = c.built && TOPICS.find((t) => t.id === c.built)
          return lesson ? (
            <button
              key={name}
              onClick={() => openTopic(lesson)}
              className="cursor-pointer rounded-full border border-line px-3 py-1.5 font-mono text-xs transition hover:border-fg"
            >
              {name}
            </button>
          ) : (
            <span key={name} className="rounded-full border border-dashed border-line px-3 py-1.5 font-mono text-xs text-muted">
              {name} · coming
            </span>
          )
        })}
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        {built && topic ? (
          <button onClick={() => openTopic(topic)} className="cursor-pointer rounded-full bg-fg px-5 py-2.5 text-sm font-medium text-bg transition hover:opacity-90">
            {state === 'done' ? 'Replay project' : 'Start project'}
          </button>
        ) : (
          <span className="rounded-full border border-dashed border-line px-5 py-2.5 text-sm text-muted">Coming soon</span>
        )}
        <span className="text-xs text-muted">Every concept is open. Learn one first, or start and learn as things break.</span>
      </div>
    </section>
  )
}
