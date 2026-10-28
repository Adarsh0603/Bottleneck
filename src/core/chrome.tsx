import { useState } from 'react'
import { isSoundOn, setSoundOn } from './sound'
import Tooltip from './Tooltip'
import type { Level } from './types'

export const CHEAT_SHEET = 'Interview cheat sheet'

// The top row shared by every chapter screen: the chapter menu, its level,
// and the sound toggle.
export function TopBar({
  chapters,
  index,
  doneChapters,
  onChapter,
  extra,
  title,
}: {
  // A locked chapter shows in the menu but cannot be opened yet.
  chapters: { title: string; level: Level; locked?: boolean }[]
  index: number
  doneChapters: number[]
  onChapter: (index: number) => void
  // One more stop after the chapters, e.g. the cheat sheet.
  extra?: { title: string; onOpen: () => void }
  // Replaces the chapter name in the middle.
  title?: string
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [sound, setSound] = useState(isSoundOn)
  const chapter = chapters[index]

  return (
    <div className="grid grid-cols-[1fr_auto] items-center gap-3 md:grid-cols-[1fr_auto_1fr]">
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
                <Tooltip as="div" text={c.locked ? 'Finish the stage before it to open this' : undefined}>
                <button
                  disabled={c.locked}
                  onClick={() => {
                    setMenuOpen(false)
                    onChapter(i)
                  }}
                  className={`flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm transition hover:bg-subtle disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent ${
                    i === index ? 'font-medium' : 'text-muted'
                  }`}
                >
                  <span className="font-mono text-xs">{String(i + 1).padStart(2, '0')}</span>
                  <span className="flex-1">{c.title}</span>
                  {c.locked && (
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" role="img" aria-label="locked">
                      <rect x="2.5" y="5.5" width="7" height="5" rx="1" />
                      <path d="M4 5.5V4a2 2 0 0 1 4 0v1.5" />
                    </svg>
                  )}
                  {doneChapters.includes(i) && (
                    <span className="font-mono text-xs text-fg" aria-label="done">
                      ✓
                    </span>
                  )}
                </button>
                </Tooltip>
              </li>
            ))}
            {extra && (
              <li className="border-t border-line">
                <button
                  onClick={() => {
                    setMenuOpen(false)
                    extra.onOpen()
                  }}
                  className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm text-muted transition hover:bg-subtle"
                >
                  <span className="font-mono text-xs">{String(chapters.length + 1).padStart(2, '0')}</span>
                  <span className="flex-1">{extra.title}</span>
                </button>
              </li>
            )}
          </ol>
        )}
      </div>
      <h1 className="hidden max-w-[40vw] truncate text-center text-lg font-semibold tracking-tight md:block">
        {title ?? chapter.title}
      </h1>
      <button
        onClick={() => {
          setSoundOn(!sound)
          setSound(!sound)
        }}
        className="pointer-events-auto shrink-0 justify-self-end rounded-full border border-line bg-bg/80 px-3 py-1.5 font-mono text-xs text-muted backdrop-blur transition hover:text-fg"
      >
        Sound {sound ? 'on' : 'off'}
      </button>
    </div>
  )
}
