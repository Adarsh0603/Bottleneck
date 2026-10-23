import { useState } from 'react'
import HomeList from './HomeList'
import HomeMap from './HomeMap'
import type { HomeView } from './parts'

const KEY = 'home-view'

// The map by default on larger screens, the list on phones. The viewer's
// choice is remembered.
function initialView(): HomeView {
  try {
    const saved = localStorage.getItem(KEY)
    if (saved === 'map' || saved === 'list') return saved
  } catch {
    // Fall through to the default.
  }
  return window.matchMedia('(min-width: 768px)').matches ? 'map' : 'list'
}

export default function Home() {
  const [view, setView] = useState(initialView)
  const change = (v: HomeView) => {
    setView(v)
    try {
      localStorage.setItem(KEY, v)
    } catch {
      // Not remembered, but still switches for this visit.
    }
  }
  return view === 'map' ? <HomeMap onView={change} /> : <HomeList onView={change} />
}
