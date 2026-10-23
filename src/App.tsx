import { useState } from 'react'
import { defaultRenderer, saveRenderer, type Renderer } from './course/device'
import Player from './course/Player'

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
  const [renderer, setRenderer] = useState<Renderer>(defaultRenderer)

  const pickRenderer = (r: Renderer) => {
    setRenderer(r)
    saveRenderer(r)
  }

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 h-[57px] border-b border-line bg-bg/70 backdrop-blur-md">
        <div className="flex h-full items-center justify-between gap-3 px-4">
          <div className="flex items-center gap-3">
            <img src="/favicon.svg" alt="" className="h-6 w-6" />
            <span className="font-semibold tracking-tight">Bottleneck</span>
            <span className="hidden text-line sm:inline">/</span>
            <span className="hidden text-sm text-muted sm:inline">Load Balancing</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex rounded-full border border-line p-0.5 font-mono text-xs" title="3D or lightweight isometric view">
              {(['3d', 'iso'] as const).map((r) => (
                <button
                  key={r}
                  onClick={() => pickRenderer(r)}
                  className={`rounded-full px-2.5 py-0.5 transition ${renderer === r ? 'bg-fg text-bg' : 'text-muted hover:text-fg'}`}
                >
                  {r.toUpperCase()}
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
      <Player renderer={renderer} />
    </div>
  )
}
