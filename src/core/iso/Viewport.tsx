import { useEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react'
import type { Marker, V3 } from '../types'
import { frameScale, project, VIEW_H, VIEW_W } from './geometry'
import { IsoGrid, MarkerPin } from './primitives'

const MIN_ZOOM = 0.5
const MAX_ZOOM = 3
const ZOOM_STEP = 1.25
const clampZoom = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z))

export interface Frame {
  now: number // ms timestamp of this animation frame
  dt: number // seconds since the previous frame
}

// The camera for an iso scene: redraws every animation frame, glides toward
// the target, shakes on demand, and lets the viewer zoom (buttons, wheel or
// pinch) and drag to pan. Panning resets whenever `panKey` changes.
export default function Viewport({
  target,
  zoom,
  shake,
  panKey,
  label,
  controlsSide = 'right',
  markers = [],
  children,
}: {
  target: V3
  zoom: number
  shake: number
  panKey: unknown
  label: string
  controlsSide?: 'left' | 'right'
  markers?: Marker[]
  children: (frame: Frame) => ReactNode
}) {
  const [now, setNow] = useState(() => performance.now())
  useEffect(() => {
    let id = requestAnimationFrame(function loop(t) {
      setNow(t)
      id = requestAnimationFrame(loop)
    })
    return () => cancelAnimationFrame(id)
  }, [])

  // Track the on-screen size so the scene can be framed for it.
  const boxRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: VIEW_W, h: VIEW_H })
  useEffect(() => {
    const el = boxRef.current
    if (!el) return
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      if (width > 0 && height > 0) setSize({ w: width, h: height })
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const view = useRef<{ cx: number; cy: number; zoom: number } | null>(null)
  const lastFrame = useRef(now)
  const shakeUntil = useRef(0)
  useEffect(() => {
    if (shake > 0) shakeUntil.current = performance.now() + 380
  }, [shake])

  const svgRef = useRef<SVGSVGElement>(null)
  const [userZoom, setUserZoom] = useState(1)
  const pan = useRef({ x: 0, y: 0 })
  const lastPanKey = useRef(panKey)
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const pinchGap = useRef<number | null>(null)
  const dragged = useRef(false)

  useEffect(() => {
    const el = svgRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      setUserZoom((z) => clampZoom(z * (e.deltaY < 0 ? 1.1 : 1 / 1.1)))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  const dt = Math.min(0.1, (now - lastFrame.current) / 1000)
  lastFrame.current = now
  const ease = 1 - Math.exp(-dt * 3)

  if (lastPanKey.current !== panKey) {
    lastPanKey.current = panKey
    pan.current = { x: 0, y: 0 }
  }
  const goalZoom = zoom * userZoom
  const [gx, gy] = project(target)
  const v = (view.current ??= { cx: gx, cy: gy, zoom: goalZoom })
  v.cx += (gx - v.cx) * ease
  v.cy += (gy - v.cy) * ease
  v.zoom += (goalZoom - v.zoom) * ease
  const shaking = now < shakeUntil.current
  const jx = shaking ? (Math.random() - 0.5) * 10 : 0
  const jy = shaking ? (Math.random() - 0.5) * 10 : 0

  const unitsPerPixel = 1 / (frameScale(size.w, size.h) * v.zoom)
  const w = size.w * unitsPerPixel
  const h = size.h * unitsPerPixel

  // Captions cover more of the bottom than the stats cover of the top, so
  // frame the subject a little above the middle; more so on phones, where
  // the caption takes a bigger share of the screen.
  const narrow = size.w < 640
  const left = v.cx - w / 2 + jx + pan.current.x
  const top = v.cy - h / 2 + h * (narrow ? 0.1 : 0.06) + jy + pan.current.y

  // One finger or the mouse pans; two fingers pinch to zoom.
  const gap = () => {
    const [a, b] = [...pointers.current.values()]
    return Math.hypot(a.x - b.x, a.y - b.y)
  }
  const onDown = (e: PointerEvent) => {
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (pointers.current.size === 1) dragged.current = false
    if (pointers.current.size === 2) pinchGap.current = gap()
  }
  const onMove = (e: PointerEvent) => {
    const last = pointers.current.get(e.pointerId)
    if (!last) return
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })

    if (pointers.current.size === 2 && pinchGap.current) {
      const next = gap()
      const ratio = next / pinchGap.current
      pinchGap.current = next
      dragged.current = true
      setUserZoom((z) => clampZoom(z * ratio))
      return
    }

    const dx = e.clientX - last.x
    const dy = e.clientY - last.y
    if (!dragged.current && Math.hypot(dx, dy) < 4) {
      pointers.current.set(e.pointerId, last) // keep measuring from the start
      return
    }
    dragged.current = true
    pan.current.x -= dx * unitsPerPixel
    pan.current.y -= dy * unitsPerPixel
  }
  const onUp = (e: PointerEvent) => {
    pointers.current.delete(e.pointerId)
    if (pointers.current.size < 2) pinchGap.current = null
  }

  const zoomBtn =
    'grid h-9 w-9 place-items-center rounded-lg text-lg leading-none transition hover:bg-subtle disabled:cursor-not-allowed disabled:opacity-30'
  const reset = () => {
    setUserZoom(1)
    pan.current = { x: 0, y: 0 }
  }
  const moved = userZoom !== 1 || pan.current.x !== 0 || pan.current.y !== 0

  return (
    <div ref={boxRef} className="relative h-full w-full">
      {narrow ? (
        // Phones pinch and drag instead of using buttons; offer a way back
        // once the view has been moved.
        moved && (
          <button
            onClick={reset}
            className="absolute right-3 top-36 z-10 rounded-full border border-line bg-bg/90 px-3 py-1.5 font-mono text-xs backdrop-blur"
          >
            ⟲ Reset view
          </button>
        )
      ) : (
        <div
          className={`absolute top-1/2 z-10 flex -translate-y-1/2 flex-col gap-1 rounded-xl border border-line bg-bg/80 p-1 backdrop-blur ${
            controlsSide === 'left' ? 'left-4' : 'right-4'
          }`}
        >
          <button
            className={zoomBtn}
            onClick={() => setUserZoom((z) => clampZoom(z * ZOOM_STEP))}
            disabled={userZoom >= MAX_ZOOM}
            aria-label="Zoom in"
          >
            +
          </button>
          <button
            className={zoomBtn}
            onClick={() => setUserZoom((z) => clampZoom(z / ZOOM_STEP))}
            disabled={userZoom <= MIN_ZOOM}
            aria-label="Zoom out"
          >
            −
          </button>
          <button className={`${zoomBtn} text-sm`} onClick={reset} aria-label="Reset view" title="Reset view">
            ⟲
          </button>
        </div>
      )}
      <svg
        ref={svgRef}
        viewBox={`${left} ${top} ${w} ${h}`}
        className="h-full w-full cursor-grab touch-none select-none active:cursor-grabbing"
        role="img"
        aria-label={`${label} Drag to pan; scroll or pinch to zoom.`}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        onPointerLeave={onUp}
        onClickCapture={(e) => {
          // A drag or pinch that ends over something clickable shouldn't click it.
          if (dragged.current) {
            e.stopPropagation()
            dragged.current = false
          }
        }}
      >
        <IsoGrid />
        {children({ now, dt })}
        {markers.map((m) => (
          <MarkerPin key={m.label} marker={m} />
        ))}
      </svg>
    </div>
  )
}
