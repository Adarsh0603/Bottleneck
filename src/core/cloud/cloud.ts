import { initializeApp } from 'firebase/app'
import { GoogleAuthProvider, getAuth, onAuthStateChanged, signInWithPopup, signOut } from 'firebase/auth'
import { doc, getDoc, getFirestore, setDoc } from 'firebase/firestore'
import { allBuilds, mergeBuilds, onBuildsChange, parse as parseBuilds, replaceBuilds, whenBuildsLoaded } from '../build/saved'
import type { CloudUser } from './session'
import { currentProgress, mergeProgress, onProgressChange, parse as parseProgress, replaceProgress } from '../progress'

// Sign in with Google and keep progress and builds in Firestore, one document
// per learner (users/{uid}). Local storage stays the source the app reads;
// this file only merges with the cloud copy and pushes changes up. The config
// below is public by design: the Firestore rules decide who can read what.
const app = initializeApp({
  apiKey: 'AIzaSyD1NGSVsMvyzDH_cr5mP-5CkPgX2vTBjeA',
  authDomain: 'systemlands.firebaseapp.com',
  projectId: 'systemlands',
  storageBucket: 'systemlands.firebasestorage.app',
  messagingSenderId: '69942955447',
  appId: '1:69942955447:web:2e2f2588be4d1cd9136c32',
})
const auth = getAuth(app)
const db = getFirestore(app)

const PUSH_DELAY = 1500

let stopSync: (() => void) | null = null
// Sends any change still waiting out its delay.
let flushSync: (() => Promise<void>) | null = null

async function startSync(uid: string, alive: () => boolean) {
  const ref = doc(db, 'users', uid)
  const snap = await getDoc(ref)
  await whenBuildsLoaded()
  if (!alive()) return
  const remote = snap.exists() ? snap.data() : {}
  replaceProgress(mergeProgress(currentProgress(), parseProgress(typeof remote.progress === 'string' ? remote.progress : null)))
  replaceBuilds(mergeBuilds(allBuilds(), parseBuilds(typeof remote.builds === 'string' ? remote.builds : null)))

  const push = () =>
    setDoc(ref, { progress: JSON.stringify(currentProgress()), builds: JSON.stringify(allBuilds()), updatedAt: Date.now() })
  await push()
  if (!alive()) return

  let timer: ReturnType<typeof setTimeout> | undefined
  const schedule = () => {
    clearTimeout(timer)
    timer = setTimeout(() => void push().catch(() => {}), PUSH_DELAY)
  }
  const offs = [onProgressChange(schedule), onBuildsChange(schedule)]
  stopSync = () => {
    clearTimeout(timer)
    offs.forEach((off) => off())
    flushSync = null
  }
  flushSync = () => {
    clearTimeout(timer)
    return push()
  }
}

// Calls back with the signed-in learner (or null) now and whenever it changes.
export function watchUser(onUser: (user: CloudUser | null) => void): () => void {
  let session = 0
  const off = onAuthStateChanged(auth, (user) => {
    const mine = ++session
    stopSync?.()
    stopSync = null
    onUser(user ? { name: user.displayName ?? 'Signed in', email: user.email ?? '', photo: user.photoURL } : null)
    if (user) void startSync(user.uid, () => mine === session).catch(() => {})
  })
  return () => {
    session++
    stopSync?.()
    stopSync = null
    off()
  }
}

export async function signIn() {
  try {
    await signInWithPopup(auth, new GoogleAuthProvider())
  } catch (e) {
    const code = (e as { code?: string }).code
    if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') return
    window.alert('Sign in failed. Please try again.')
  }
}

// Signing out leaves nothing of the account on this device. The cloud copy is
// sent first; if that fails, stay signed in rather than lose the latest changes.
export async function logOut() {
  try {
    await flushSync?.()
  } catch {
    window.alert('Could not save your latest progress. Check your connection and try again.')
    return
  }
  stopSync?.()
  stopSync = null
  replaceProgress({})
  replaceBuilds({})
  await signOut(auth)
}
