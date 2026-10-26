import { useSyncExternalStore } from 'react'

// Who is signed in and whether the sign-in dialog is open. Kept apart from
// cloud.ts so reading it never pulls the Firebase code into the first load.

export interface CloudUser {
  name: string
  email: string
  photo: string | null
}

export interface Notice {
  title: string
  body: string
}

interface Session {
  user: CloudUser | null
  dialog: boolean
  notice: Notice | null // the result of a sign-in, shown once it is done
}

let state: Session = { user: null, dialog: false, notice: null }
const listeners = new Set<() => void>()

function set(next: Session) {
  state = next
  listeners.forEach((l) => l())
}

export function useSession(): Session {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => {
        listeners.delete(l)
      }
    },
    () => state,
  )
}

// Signing in closes the dialog.
export const setUser = (user: CloudUser | null) => set({ ...state, user, dialog: user ? false : state.dialog })
export const showNotice = (notice: Notice) => set({ ...state, notice })
export const closeNotice = () => set({ ...state, notice: null })
export const openSignIn = () => set({ ...state, dialog: true })
export const closeSignIn = () => set({ ...state, dialog: false })
