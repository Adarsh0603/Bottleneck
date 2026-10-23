import { useState } from 'react'
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

  return (
    <>
      <div className="grid-floor" aria-hidden="true" />
      <div className="relative min-h-screen">
        <header className="sticky top-0 z-10 border-b border-line bg-bg/70 backdrop-blur-md">
          <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3.5">
            <div className="flex items-center gap-3">
              <img src="/favicon.svg" alt="" className="h-6 w-6" />
              <span className="font-semibold tracking-tight">Bottleneck</span>
              <span className="text-line">/</span>
              <span className="text-sm text-muted">Load Balancing</span>
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
        <main className="mx-auto max-w-6xl px-4 py-8 sm:py-10">
          <LoadBalancerCourse />
        </main>
      </div>
    </>
  )
}
