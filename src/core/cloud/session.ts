import { useSyncExternalStore } from 'react'

// Who is signed in and whether the sign-in dialog is open. Kept apart from
// cloud.ts so reading it never pulls the Firebase code into the first load.

export interface CloudUser {
  name: string
  email: string
  photo: string | null
}

interface Session {
  user: CloudUser | null
  dialog: boolean
}

let state: Session = { user: null, dialog: false }
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
export const setUser = (user: CloudUser | null) => set({ user, dialog: user ? false : state.dialog })
export const openSignIn = () => set({ ...state, dialog: true })
export const closeSignIn = () => set({ ...state, dialog: false })
