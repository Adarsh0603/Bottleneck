import { useEffect, useState } from 'react'

// Hash-based links, so any place in the app can be shared or bookmarked:
//   #/                      home
//   #/load-balancing        a topic, chapter 1
//   #/load-balancing/3      chapter 3
//   #/load-balancing/3/2    chapter 3, step 2
// Numbers in the URL count from 1; in code they count from 0.

export type Route = { page: 'home' } | { page: 'topic'; topic: string; chapter: number; step: number }

const index = (s: string | undefined) => {
  const n = Number(s)
  return Number.isInteger(n) && n >= 1 ? n - 1 : 0
}

export function parseRoute(hash: string): Route {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean)
  if (parts.length === 0) return { page: 'home' }
  return { page: 'topic', topic: decodeURIComponent(parts[0]), chapter: index(parts[1]), step: index(parts[2]) }
}

export function formatRoute(route: Route): string {
  if (route.page === 'home') return '#/'
  const base = `#/${encodeURIComponent(route.topic)}/${route.chapter + 1}`
  return route.step > 0 ? `${base}/${route.step + 1}` : base
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseRoute(window.location.hash))
  useEffect(() => {
    const onChange = () => setRoute(parseRoute(window.location.hash))
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])
  return route
}

// Go somewhere new (adds a browser history entry).
export function navigate(route: Route) {
  window.location.hash = formatRoute(route)
}

// Keep the address bar in sync without adding history or re-rendering, e.g.
// as the learner steps through a chapter.
export function replaceRoute(route: Route) {
  history.replaceState(null, '', formatRoute(route))
}
