export type Renderer = '3d' | 'iso'

// Use the lightweight isometric view when WebGL is missing or the device
// looks low-powered. The viewer can still switch either way.
export function defaultRenderer(): Renderer {
  try {
    const saved = localStorage.getItem('renderer')
    if (saved === '3d' || saved === 'iso') return saved
  } catch {
    // Fall through to detection.
  }

  try {
    const canvas = document.createElement('canvas')
    if (!canvas.getContext('webgl2') && !canvas.getContext('webgl')) return 'iso'
  } catch {
    return 'iso'
  }
  const nav = navigator as Navigator & { deviceMemory?: number }
  if (nav.deviceMemory !== undefined && nav.deviceMemory < 4) return 'iso'
  if (nav.hardwareConcurrency && nav.hardwareConcurrency < 4) return 'iso'
  return '3d'
}

export function saveRenderer(renderer: Renderer) {
  try {
    localStorage.setItem('renderer', renderer)
  } catch {
    // Not remembered, but still applies for this visit.
  }
}
