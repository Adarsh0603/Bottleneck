import { useEffect, useRef } from 'react'

// Tracks the height of the bottom caption block (minus its fade padding) and
// publishes it as --bottom-inset on the root, so overlays inside the scene,
// like the phone "Reset view" button, can sit just above the text.
// Pass a value that changes when the bottom block is swapped for another element.
export function useBottomInset<R extends HTMLElement, B extends HTMLElement>(layout?: unknown) {
  const root = useRef<R>(null)
  const bottom = useRef<B>(null)
  useEffect(() => {
    const r = root.current
    const b = bottom.current
    if (!r || !b) return
    const apply = () => r.style.setProperty('--bottom-inset', `${b.offsetHeight ? b.offsetHeight - parseFloat(getComputedStyle(b).paddingTop) : 0}px`)
    apply()
    const observer = new ResizeObserver(apply)
    observer.observe(b)
    return () => observer.disconnect()
  }, [layout])
  return { root, bottom }
}
