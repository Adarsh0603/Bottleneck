import { useState } from 'react'
import { useProgress } from '../core/progress'
import { ContinueButton } from './parts'
import { PROJECTS } from './projects'
import ProjectCard from './ProjectCard'
import RealmMap from './RealmMap'
import { projectStates } from './shared'
import Toolbox from './Toolbox'

export default function Home() {
  const progress = useProgress()
  const states = projectStates(progress)
  const next = PROJECTS.find((p) => states[p.id] === 'next') ?? PROJECTS[0]
  const [picked, setPicked] = useState<string | null>(null)
  const project = PROJECTS.find((p) => p.id === picked) ?? next

  return (
    <main className="pb-10 pt-10 sm:pb-14 sm:pt-14">
      <div className="mx-auto max-w-6xl px-4">
        <div className="font-mono text-[11px] uppercase tracking-widest text-muted">Conquer each kingdom</div>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-5xl">The Realm of Systems</h1>
        <p className="mt-3 max-w-2xl text-muted">
          Build the systems interviews ask about, from a link shortener to WhatsApp to your own AI agent. Open any concept whenever you want; the mist lifts as you finish projects.
        </p>
        <ContinueButton className="mt-6" />
      </div>

      <div className="mx-auto mt-8 max-w-6xl px-4">
        <div className="overflow-hidden rounded-2xl border border-line">
          <RealmMap states={states} selected={project.id} onSelect={setPicked} />
        </div>
      </div>

      <div className="mx-auto max-w-6xl px-4">
        <ProjectCard project={project} state={states[project.id]} />
        <Toolbox />
      </div>
    </main>
  )
}
