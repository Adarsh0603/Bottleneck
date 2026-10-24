import { useSyncExternalStore } from 'react'

// True while the CSS media query matches; updates when the screen changes
// (rotating a phone, resizing a window).
export function useMedia(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mq = window.matchMedia(query)
      mq.addEventListener('change', onChange)
      return () => mq.removeEventListener('change', onChange)
    },
    () => window.matchMedia(query).matches,
  )
}

// Phones held upright, and anything short like a phone on its side.
export const COMPACT = '(max-width: 639px), (max-height: 520px)'
export const SHORT = '(max-height: 520px)'
export const PHONE = '(max-width: 639px)'
