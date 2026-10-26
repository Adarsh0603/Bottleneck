import { useEffect, useSyncExternalStore } from 'react'

// An in-app replacement for window.confirm: askConfirm() resolves true when
// the learner confirms and false when they cancel, press Esc or click away.
// <ConfirmHost /> is rendered once, in the app shell.

interface Ask {
  title: string
  body: string
  confirm: string
  resolve: (ok: boolean) => void
}

let current: Ask | null = null
const listeners = new Set<() => void>()

function set(next: Ask | null) {
  current = next
  listeners.forEach((l) => l())
}

export function askConfirm(options: { title: string; body: string; confirm: string }): Promise<boolean> {
  current?.resolve(false)
  return new Promise((resolve) => set({ ...options, resolve }))
}

export function ConfirmHost() {
  const ask = useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => {
        listeners.delete(l)
      }
    },
    () => current,
  )

  useEffect(() => {
    if (!ask) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      ask.resolve(false)
      set(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [ask])

  if (!ask) return null
  const answer = (ok: boolean) => {
    ask.resolve(ok)
    set(null)
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => answer(false)}>
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby="confirm-body"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm rounded-2xl border border-line bg-bg p-5 shadow-xl"
      >
        <h2 id="confirm-title" className="text-lg font-semibold tracking-tight">
          {ask.title}
        </h2>
        <p id="confirm-body" className="mt-2 text-sm text-muted">
          {ask.body}
        </p>
        <div className="mt-4 flex gap-2">
          <button
            onClick={() => answer(false)}
            className="h-10 flex-1 rounded-full border border-line px-4 text-sm transition hover:border-fg"
          >
            Cancel
          </button>
          <button
            autoFocus
            onClick={() => answer(true)}
            className="h-10 flex-1 rounded-full bg-fg px-4 text-sm font-medium text-bg transition hover:opacity-85"
          >
            {ask.confirm}
          </button>
        </div>
      </div>
    </div>
  )
}
