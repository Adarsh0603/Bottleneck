import { useState } from 'react'
import Player from './prototype3d/Player'
import LoadBalancerCourse from './simulators/loadBalancer/Course'

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

export default function App() {
  const { dark, toggle } = useTheme()
  const [view, setView] = useState<'3d' | 'iso' | '2d'>('3d')

  return (
    <>
      {view === '2d' && <div className="grid-floor" aria-hidden="true" />}
      <div className="relative min-h-screen">
        <header className="sticky top-0 z-10 h-[57px] border-b border-line bg-bg/70 backdrop-blur-md">
          <div className="mx-auto flex h-full max-w-6xl items-center justify-between gap-3 px-4">
            <div className="flex items-center gap-3">
              <img src="/favicon.svg" alt="" className="h-6 w-6" />
              <span className="font-semibold tracking-tight">Bottleneck</span>
              <span className="hidden text-line sm:inline">/</span>
              <span className="hidden text-sm text-muted sm:inline">Load Balancing</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="flex rounded-full border border-line p-0.5 font-mono text-xs">
                {(['3d', 'iso', '2d'] as const).map((v) => (
                  <button
                    key={v}
                    onClick={() => setView(v)}
                    className={`rounded-full px-2.5 py-0.5 transition ${view === v ? 'bg-fg text-bg' : 'text-muted hover:text-fg'}`}
                  >
                    {v.toUpperCase()}
                  </button>
                ))}
              </div>
              <button
                onClick={toggle}
                className="rounded-full border border-line px-3 py-1 font-mono text-xs text-muted transition hover:text-fg"
                aria-label="Toggle theme"
              >
                {dark ? 'Light' : 'Dark'}
              </button>
            </div>
          </div>
        </header>
        {view !== '2d' ? (
          <Player key={view} mode={view} />
        ) : (
          <main className="mx-auto max-w-6xl px-4 py-8 sm:py-10">
            <LoadBalancerCourse />
          </main>
        )}
      </div>
    </>
  )
}
