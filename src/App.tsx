import { useState } from 'react'
import { TOPICS } from './topics/registry'

function useTheme() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'))
  const toggle = () => {
    const next = !dark
    setDark(next)
    document.documentElement.classList.toggle('dark', next)
    try {
      localStorage.setItem('theme', next ? 'dark' : 'light')
    } catch {
      // Storage can be blocked; the toggle still works for this visit.
    }
  }
  return { dark, toggle }
}

// Until navigation arrives (part 2), the app opens straight into the first topic.
const topic = TOPICS[0]

export default function App() {
  const { dark, toggle } = useTheme()
  const [chapter, setChapter] = useState(0)
  const Play = topic.Play

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 h-[57px] border-b border-line bg-bg/70 backdrop-blur-md">
        <div className="flex h-full items-center justify-between gap-3 px-4">
          <div className="flex items-center gap-3">
            <img src="/favicon.svg" alt="" className="h-6 w-6" />
            <span className="font-semibold tracking-tight">Bottleneck</span>
            <span className="hidden text-line sm:inline">/</span>
            <span className="hidden text-sm text-muted sm:inline">{topic.title}</span>
          </div>
          <button
            onClick={toggle}
            className="rounded-full border border-line px-3 py-1 font-mono text-xs text-muted transition hover:text-fg"
            aria-label="Toggle theme"
          >
            {dark ? 'Light' : 'Dark'}
          </button>
        </div>
      </header>
      {Play && <Play chapter={chapter} onChapter={setChapter} />}
    </div>
  )
}
