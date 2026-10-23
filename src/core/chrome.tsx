import { useState } from 'react'
import { isSoundOn, setSoundOn } from './sound'
import type { Level } from './types'

// The top row shared by every chapter screen: the chapter menu, its level,
// and the sound toggle.
export function TopBar({
  chapters,
  index,
  doneChapters,
  onChapter,
}: {
  chapters: { title: string; level: Level }[]
  index: number
  doneChapters: number[]
  onChapter: (index: number) => void
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [sound, setSound] = useState(isSoundOn)
  const chapter = chapters[index]

  return (
    <div className="flex items-center justify-between gap-3">
      <div className="pointer-events-auto relative flex min-w-0 items-center gap-2">
        <button
          onClick={() => setMenuOpen((o) => !o)}
          className="flex min-w-0 items-center gap-2 rounded-full border border-line bg-bg/80 px-3 py-1.5 text-sm backdrop-blur transition hover:border-fg"
        >
          <span className="font-mono text-xs text-muted">{String(index + 1).padStart(2, '0')}</span>
          <span className="truncate font-medium">{chapter.title}</span>
          <span className="text-muted">▾</span>
        </button>
        <span className="hidden rounded-full border border-line bg-bg/80 px-2 py-0.5 font-mono text-[10px] uppercase tracking-widest text-muted backdrop-blur sm:inline">
          {chapter.level}
        </span>
        {menuOpen && (
          <ol className="absolute left-0 top-full z-20 mt-2 w-60 overflow-hidden rounded-xl border border-line bg-bg shadow-lg">
            {chapters.map((c, i) => (
              <li key={c.title}>
                <button
                  onClick={() => {
                    setMenuOpen(false)
                    onChapter(i)
                  }}
                  className={`flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm transition hover:bg-subtle ${
                    i === index ? 'font-medium' : 'text-muted'
                  }`}
                >
                  <span className="font-mono text-xs">{String(i + 1).padStart(2, '0')}</span>
                  <span className="flex-1">{c.title}</span>
                  {doneChapters.includes(i) && (
                    <span className="font-mono text-xs text-fg" aria-label="done">
                      ✓
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ol>
        )}
      </div>
      <button
        onClick={() => {
          setSoundOn(!sound)
          setSound(!sound)
        }}
        className="pointer-events-auto shrink-0 rounded-full border border-line bg-bg/80 px-3 py-1.5 font-mono text-xs text-muted backdrop-blur transition hover:text-fg"
      >
        Sound {sound ? 'on' : 'off'}
      </button>
    </div>
  )
}
