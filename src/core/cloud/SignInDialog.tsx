import { useEffect } from 'react'
import { closeNotice, closeSignIn, setBusy, showNotice, useSession } from './session'

const GoogleG = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden>
    <path fill="#4285F4" d="M22.5 12.3c0-.8-.1-1.5-.2-2.2H12v4.2h5.9a5 5 0 0 1-2.2 3.3v2.7h3.5c2-1.9 3.3-4.7 3.3-8z" />
    <path fill="#34A853" d="M12 23c3 0 5.4-1 7.2-2.7l-3.5-2.7c-1 .7-2.2 1-3.7 1-2.9 0-5.3-1.9-6.2-4.5H2.2v2.8A11 11 0 0 0 12 23z" />
    <path fill="#FBBC05" d="M5.8 14.1a6.6 6.6 0 0 1 0-4.2V7.1H2.2a11 11 0 0 0 0 9.8z" />
    <path fill="#EA4335" d="M12 5.4c1.6 0 3.1.6 4.2 1.7l3.1-3.1A11 11 0 0 0 2.2 7.1l3.6 2.8C6.7 7.3 9.1 5.4 12 5.4z" />
  </svg>
)

// Opens from the header's Sign in button and the footer note: keep going in
// this browser, or sign in to sync across devices.
export default function SignInDialog() {
  const { dialog, notice, busy, user } = useSession()

  useEffect(() => {
    if (!dialog && !notice) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && (notice ? closeNotice() : closeSignIn())
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [dialog, notice])

  if (notice) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={closeNotice}>
        <div
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="notice-title"
          aria-describedby="notice-body"
          onClick={(e) => e.stopPropagation()}
          className="w-full max-w-sm rounded-2xl border border-line bg-bg p-5 shadow-xl"
        >
          <h2 id="notice-title" className="text-lg font-semibold tracking-tight">
            {notice.title}
          </h2>
          <p id="notice-body" className="mt-2 text-sm text-muted">
            {notice.body}
          </p>
          <button
            autoFocus
            onClick={closeNotice}
            className="mt-4 h-10 w-full rounded-full bg-fg px-4 text-sm font-medium text-bg transition hover:opacity-85"
          >
            Done
          </button>
        </div>
      </div>
    )
  }
  if (!dialog) return null
  // The wait starts at the click: loading the sign-in code, the popup, then the first sync.
  const google = () => {
    setBusy(true)
    void import('./cloud')
      .then((m) => m.signIn())
      .catch(() => showNotice({ title: 'Sign in failed', body: 'Something went wrong signing in. Please try again.' }))
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={closeSignIn}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="signin-title"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm rounded-2xl border border-line bg-bg p-5 shadow-xl"
      >
        <h2 id="signin-title" className="text-lg font-semibold tracking-tight">
          Keep your progress
        </h2>
        <p className="mt-2 text-sm text-muted">
          You can keep going in this browser, where your progress stays on this device only. Or sign in to sync your
          progress and builds across devices.
        </p>
        <button
          onClick={google}
          disabled={busy}
          aria-busy={busy}
          className="mt-4 flex h-10 w-full items-center justify-center gap-2 rounded-full bg-fg px-4 text-sm font-medium text-bg transition hover:opacity-85 disabled:cursor-wait disabled:opacity-70"
        >
          {busy ? (
            <span aria-hidden className="h-4 w-4 animate-spin rounded-full border-2 border-bg border-t-transparent" />
          ) : (
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-white">
              <GoogleG />
            </span>
          )}
          {busy ? (user ? 'Syncing your progress…' : 'Signing in…') : 'Sign in with Google'}
        </button>
        <button
          onClick={closeSignIn}
          className="mt-2 h-10 w-full rounded-full border border-line px-4 text-sm transition hover:border-fg"
        >
          Continue in this browser
        </button>
      </div>
    </div>
  )
}
