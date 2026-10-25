import { useEffect, useState } from 'react'
import type { PieceKind, Placement, Settings } from './types'
import { PIECE_NAMES } from './types'

// Builds the learner has made, kept between visits. Everything that reads or
// writes a build goes through this file. The backend is the only part that
// knows where builds live: swap it (setBackend) to keep them in a database.

export interface SavedBuild {
  placed: Placement
  settings: Settings
}

export interface BuildBackend {
  load(): Promise<Record<string, SavedBuild>>
  save(key: string, build: SavedBuild): Promise<void>
  remove(key: string): Promise<void>
}

const KEY = 'bottleneck.builds.v1'

// Anything unexpected in storage (old format, hand-edited) is ignored rather
// than crashing the app.
export function parse(raw: string | null): Record<string, SavedBuild> {
  if (!raw) return {}
  try {
    const data: unknown = JSON.parse(raw)
    if (!data || typeof data !== 'object') return {}
    const out: Record<string, SavedBuild> = {}
    for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
      const b = value as Partial<SavedBuild> | null
      if (!b || typeof b.placed !== 'object' || !b.placed) continue
      const placed: Placement = {}
      for (const [pad, kind] of Object.entries(b.placed)) if (kind in PIECE_NAMES) placed[pad] = kind as PieceKind
      const settings: Settings = {}
      for (const [id, v] of Object.entries(b.settings ?? {})) if (typeof v === 'number' && Number.isFinite(v)) settings[id] = v
      out[key] = { placed, settings }
    }
    return out
  } catch {
    return {}
  }
}

export const localBackend: BuildBackend = {
  async load() {
    try {
      return parse(localStorage.getItem(KEY))
    } catch {
      return {}
    }
  },
  async save(key, build) {
    try {
      const all = parse(localStorage.getItem(KEY))
      all[key] = build
      localStorage.setItem(KEY, JSON.stringify(all))
    } catch {
      // Storage blocked or full: the build still works for this visit.
    }
  },
  async remove(key) {
    try {
      const all = parse(localStorage.getItem(KEY))
      delete all[key]
      localStorage.setItem(KEY, JSON.stringify(all))
    } catch {
      // Nothing to clean up if storage is unavailable.
    }
  },
}

// --- Store -----------------------------------------------------------------

let backend: BuildBackend = localBackend
let cache: Record<string, SavedBuild> = {}
let loaded = false
let loading: Promise<void> | null = null
const listeners = new Set<() => void>()

function load(): Promise<void> {
  loading ??= backend
    .load()
    .catch(() => ({}) as Record<string, SavedBuild>)
    .then((all) => {
      cache = { ...all, ...cache }
      loaded = true
      listeners.forEach((l) => l())
    })
  return loading
}

// Use a different backend (e.g. a database). Call before any build is shown.
export function setBackend(next: BuildBackend) {
  backend = next
  cache = {}
  loaded = false
  loading = null
  void load()
}

void load()

export const getBuild = (key: string): SavedBuild | undefined => cache[key]

export function saveBuild(key: string, build: SavedBuild) {
  cache = { ...cache, [key]: build }
  void backend.save(key, build).catch(() => {})
}

export function clearBuild(key: string) {
  cache = { ...cache }
  delete cache[key]
  void backend.remove(key).catch(() => {})
}

// False until the saved builds have arrived; with local storage that is
// already true by the time a build page opens.
export function useBuildsLoaded(): boolean {
  const [ok, setOk] = useState(loaded)
  useEffect(() => {
    const update = () => setOk(loaded)
    listeners.add(update)
    update()
    void load()
    return () => {
      listeners.delete(update)
    }
  }, [])
  return ok
}
