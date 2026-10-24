import { useState } from 'react'
import { splitLead } from './splitLead'
import type { Reference } from './types'

// A page of short, scannable notes to revisit before an interview: what to
// say, up top, and the details behind it, folded away until wanted.
export default function ReferenceSheet({ reference, title, sub }: { reference: Reference; title: string; sub?: string }) {
  const [open, setOpen] = useState<Set<string>>(new Set())
  const all = open.size === reference.cards.length
  const toggle = (key: string) =>
    setOpen((prev) => {
      const next = new Set(prev)
      if (!next.delete(key)) next.add(key)
      return next
    })

  return (
    <div className="caption-in absolute inset-0 z-10 overflow-y-auto bg-bg px-4 pb-44 pt-20 sm:pb-40 sm:pt-24">
      <div className="mx-auto max-w-3xl">
        <div className="font-mono text-[10px] uppercase tracking-widest text-muted">Cheat sheet</div>
        <h2 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h2>
        {sub && <p className="mt-1 text-sm text-muted sm:text-base">{sub}</p>}

        <div className="mt-8 font-mono text-[10px] uppercase tracking-widest text-muted">Say this</div>
        <ol className="mt-3 divide-y divide-line border-y border-line">
          {reference.interview.map((point, i) => {
            const { lead, rest } = splitLead(point)
            return (
              <li key={point} className="flex gap-4 py-3.5">
                <span className="w-5 shrink-0 pt-0.5 font-mono text-xs text-muted">{String(i + 1).padStart(2, '0')}</span>
                <div className="min-w-0">
                  <p className="text-sm font-medium sm:text-base">{lead}</p>
                  {rest && <p className="mt-1 text-sm leading-6 text-muted">{rest}</p>}
                </div>
              </li>
            )
          })}
        </ol>

        <div className="mt-8 flex items-center justify-between">
          <div className="font-mono text-[10px] uppercase tracking-widest text-muted">Know these</div>
          <button
            onClick={() => setOpen(all ? new Set() : new Set(reference.cards.map((c) => c.title)))}
            className="font-mono text-xs text-muted underline-offset-4 transition hover:text-fg hover:underline"
          >
            {all ? 'Collapse all' : 'Expand all'}
          </button>
        </div>
        <div className="mt-3 grid items-start gap-2 sm:grid-cols-2">
          {reference.cards.map((card) => {
            const isOpen = open.has(card.title)
            return (
              <div key={card.title} className={`rounded-xl border transition ${isOpen ? 'border-fg' : 'border-line hover:border-fg'}`}>
                <button
                  onClick={() => toggle(card.title)}
                  aria-expanded={isOpen}
                  className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
                >
                  <span className="text-sm font-medium">{card.title}</span>
                  <span className="font-mono text-sm text-muted" aria-hidden>
                    {isOpen ? '−' : '+'}
                  </span>
                </button>
                {isOpen && <p className="px-4 pb-4 text-sm leading-6 text-muted">{card.body}</p>}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
