import { useEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react'
import type { V3 } from '../types'
import { project } from './geometry'
import { IsoGrid } from './primitives'

const VIEW_W = 900
const VIEW_H = 620
const MIN_ZOOM = 0.5
const MAX_ZOOM = 3
const ZOOM_STEP = 1.25
const clampZoom = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z))

export interface Frame {
  now: number // ms timestamp of this animation frame
  dt: number // seconds since the previous frame
}

// The camera for an iso scene: redraws every animation frame, glides toward
// the target, shakes on demand, and lets the viewer zoom (buttons or wheel)
// and drag to pan. Panning resets whenever `panKey` changes.
export default function Viewport({
  target,
  zoom,
  shake,
  panKey,
  label,
  controlsSide = 'right',
  children,
}: {
  target: V3
  zoom: number
  shake: number
  panKey: unknown
  label: string
  controlsSide?: 'left' | 'right'
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
  const drag = useRef<{ x: number; y: number } | null>(null)
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
  const w = VIEW_W / v.zoom
  const h = VIEW_H / v.zoom

  // Captions cover more of the bottom than the stats cover of the top, so
  // frame the subject a little above the middle.
  const left = v.cx - w / 2 + jx + pan.current.x
  const top = v.cy - h / 2 + h * 0.06 + jy + pan.current.y

  const startDrag = (e: PointerEvent) => {
    drag.current = { x: e.clientX, y: e.clientY }
    dragged.current = false
  }
  const moveDrag = (e: PointerEvent) => {
    const d = drag.current
    const el = svgRef.current
    if (!d || !el) return
    const dx = e.clientX - d.x
    const dy = e.clientY - d.y
    if (!dragged.current && Math.hypot(dx, dy) < 4) return
    dragged.current = true
    const rect = el.getBoundingClientRect()
    const unit = Math.max(w / rect.width, h / rect.height)
    pan.current.x -= dx * unit
    pan.current.y -= dy * unit
    drag.current = { x: e.clientX, y: e.clientY }
  }
  const endDrag = () => {
    drag.current = null
  }

  const zoomBtn =
    'grid h-9 w-9 place-items-center rounded-lg text-lg leading-none transition hover:bg-subtle disabled:cursor-not-allowed disabled:opacity-30'

  return (
    <div className="relative h-full w-full">
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
        <button
          className={`${zoomBtn} text-sm`}
          onClick={() => {
            setUserZoom(1)
            pan.current = { x: 0, y: 0 }
          }}
          aria-label="Reset view"
          title="Reset view"
        >
          ⟲
        </button>
      </div>
      <svg
        ref={svgRef}
        viewBox={`${left} ${top} ${w} ${h}`}
        className="h-full w-full cursor-grab touch-none select-none active:cursor-grabbing"
        role="img"
        aria-label={`${label} Drag to pan, scroll to zoom.`}
        onPointerDown={startDrag}
        onPointerMove={moveDrag}
        onPointerUp={endDrag}
        onPointerLeave={endDrag}
        onClickCapture={(e) => {
          // A drag that ends over something clickable shouldn't click it.
          if (dragged.current) {
            e.stopPropagation()
            dragged.current = false
          }
        }}
      >
        <IsoGrid />
        {children({ now, dt })}
      </svg>
    </div>
  )
}
