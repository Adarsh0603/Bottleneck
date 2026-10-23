import { useEffect, useState } from 'react'

export interface ThemeColors {
  bg: string
  fg: string
  muted: string
  line: string
  subtle: string
  danger: string
  dark: boolean
}

function read(): ThemeColors {
  const root = document.documentElement
  const css = getComputedStyle(root)
  const v = (name: string) => css.getPropertyValue(name).trim()
  return {
    bg: v('--bg'),
    fg: v('--fg'),
    muted: v('--muted'),
    line: v('--line'),
    subtle: v('--subtle'),
    danger: v('--danger'),
    dark: root.classList.contains('dark'),
  }
}

// The 3D scene can't use CSS classes, so it reads the theme tokens directly
// and re-reads them whenever the light/dark class on <html> changes.
export function useThemeColors() {
  const [colors, setColors] = useState(read)
  useEffect(() => {
    const observer = new MutationObserver(() => setColors(read()))
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    return () => observer.disconnect()
  }, [])
  return colors
}
