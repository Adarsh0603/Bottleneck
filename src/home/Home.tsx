import { useState } from 'react'
import { useProgress } from '../core/progress'
import { PROJECTS } from './projects'
import RealmMap from './RealmMap'
import { projectStates } from './shared'
import Toolbox from './Toolbox'

// One tile of small waves, drawn in black: only its shape is used, as a mask.
const WAVES = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='80' height='36'%3E%3Cg fill='none' stroke='black' stroke-width='1.2' stroke-linecap='round'%3E%3Cpath d='M0 9q10-7 20 0t20 0 20 0 20 0'/%3E%3Cpath d='M-40 27q10-7 20 0t20 0 20 0 20 0 20 0 20 0' opacity='.7'/%3E%3C/g%3E%3C/svg%3E")`

export default function Home() {
  const progress = useProgress()
  const states = projectStates(progress)
  const next = PROJECTS.find((p) => states[p.id] === 'next') ?? PROJECTS[0]
  const [picked, setPicked] = useState<string | null>(null)
  const project = PROJECTS.find((p) => p.id === picked) ?? next

  return (
    <main className="pb-10 sm:pb-14">
      {/* The sea lies under the heading and the map: rows of small waves, drifting slowly. */}
      <div className="relative pt-10 sm:pt-14">
        <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden" style={{ maskImage: 'linear-gradient(to bottom, black 88%, transparent)' }}>
          {/* The waves are a mask over a plain fill, so they take the theme's line colour. Sliding the whole layer is cheap; the page behind never repaints. */}
          <div
            className="sea-drift absolute inset-y-0 -left-20 right-0 bg-line"
            style={{ maskImage: WAVES, maskSize: '80px 36px', WebkitMaskImage: WAVES, WebkitMaskSize: '80px 36px' }}
          />
        </div>
        <div className="relative mx-auto max-w-[2200px] px-4">
          <div className="font-mono text-[11px] uppercase tracking-widest text-muted">Conquer each kingdom</div>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-5xl">The Realm of Systems</h1>
          <p className="mb-3 mt-3 max-w-2xl text-muted">
            Learn how real systems work by breaking and building them, from a link shortener to Stripe to your own AI agent.
          </p>
          <RealmMap states={states} selected={project.id} onSelect={setPicked} />
        </div>
      </div>

      <div className="mx-auto mt-4 max-w-6xl px-4">
        <Toolbox />
      </div>
    </main>
  )
}
