import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react'
import type { Marker, V3 } from '../types'
import { frameScale, project, VIEW_H, VIEW_W } from './geometry'
import { IsoGrid, MarkerPin } from './primitives'
import Tooltip from '../Tooltip'

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
  bounds,
  grid = true,
  tight = false,
  children,
}: {
  target: V3
  zoom: number
  shake: number
  panKey: unknown
  label: string
  controlsSide?: 'left' | 'right'
  markers?: Marker[]
  bounds?: V3[] // when given, frame all of these points instead of using target and zoom
  grid?: boolean // the floor grid; a small display board looks cleaner without it
  tight?: boolean // nothing is laid over the scene, so frame it using the whole box
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
  const view = useRef<{ cx: number; cy: number; zoom: number } | null>(null)
  // Measure before the first paint and start the camera on that frame, so a
  // freshly mounted board does not glide in from a frame sized for the default.
  useLayoutEffect(() => {
    const el = boxRef.current
    if (!el) return
    const { width, height } = el.getBoundingClientRect()
    if (width > 0 && height > 0) {
      view.current = null
      setSize({ w: width, h: height })
    }
  }, [])
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

  // When a question opens, start from the planned shot so every answer can be seen.
  const asks = markers.filter((m) => m.tone === 'ask')
  const askKey = asks.map((m) => m.label).join('|')
  const lastAskKey = useRef(askKey)
  if (lastAskKey.current !== askKey) {
    lastAskKey.current = askKey
    if (askKey) {
      pan.current = { x: 0, y: 0 }
      if (userZoom !== 1) setUserZoom(1)
    }
  }

  const narrow = size.w < 640
  const fs = frameScale(size.w, size.h)
  const k = tight ? 0 : narrow ? 0.1 : 0.06
  const base = bounds ? fitBounds(bounds, size, fs, k, narrow, tight) : { center: project(target), zoom }
  const fit = fitMarkers(asks, base, size, fs, k, narrow, tight)
  const goalZoom = fit.zoom * userZoom
  const [gx, gy] = fit.center
  const v = (view.current ??= { cx: gx, cy: gy, zoom: goalZoom })
  v.cx += (gx - v.cx) * ease
  v.cy += (gy - v.cy) * ease
  v.zoom += (goalZoom - v.zoom) * ease
  const shaking = now < shakeUntil.current
  const jx = shaking ? (Math.random() - 0.5) * 10 : 0
  const jy = shaking ? (Math.random() - 0.5) * 10 : 0

  const unitsPerPixel = 1 / (fs * v.zoom)
  const w = size.w * unitsPerPixel
  const h = size.h * unitsPerPixel

  // Captions cover more of the bottom than the stats cover of the top, so
  // frame the subject a little above the middle (`k`); more so on phones,
  // where the caption takes a bigger share of the screen.
  const left = v.cx - w / 2 + jx + pan.current.x
  const top = v.cy - h / 2 + h * k + jy + pan.current.y

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
            style={{ bottom: 'calc(var(--bottom-inset, 8rem) + 0.5rem)' }}
            className="absolute right-3 z-10 rounded-full border border-line bg-bg/90 px-3 py-1.5 font-mono text-xs backdrop-blur"
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
          <Tooltip text="Reset view" className="contents">
            <button className={`${zoomBtn} text-sm`} onClick={reset} aria-label="Reset view">
              ⟲
            </button>
          </Tooltip>
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
        {grid && <IsoGrid />}
        {children({ now, dt })}
        {markers.map((m) => (
          <MarkerPin key={m.label} marker={m} />
        ))}
      </svg>
    </div>
  )
}

// The part of the screen not covered by the stats on top, the question at the
// bottom and the zoom buttons at the sides, in pixels.
function clearArea(size: { w: number; h: number }, narrow: boolean, tight = false) {
  if (tight) return { x0: 40, x1: size.w - 40, y0: 40, y1: size.h - 36 }
  const short = size.h < 500
  const top = short ? 80 : narrow ? 150 : 130
  const bottom = short ? 130 : narrow ? 250 : 210
  const side = narrow ? 16 : 80
  return { x0: side, x1: size.w - side, y0: top, y1: Math.max(top + 1, size.h - bottom) }
}

// Frames every given point in the clear part of the screen, as close as fits.
// The padding leaves room for what stands on and above each point (pieces, tags).
function fitBounds(
  points: V3[],
  size: { w: number; h: number },
  fs: number,
  k: number,
  narrow: boolean,
  tight = false,
): { center: [number, number]; zoom: number } {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity
  for (const p of points) {
    const [sx, sy] = project(p)
    // Room for the piece's footprint, its name above it and the pointer tag over that.
    x0 = Math.min(x0, sx - (tight ? 140 : 60))
    x1 = Math.max(x1, sx + (tight ? 140 : 60))
    y0 = Math.min(y0, sy - (tight ? 180 : 90))
    y1 = Math.max(y1, sy + (tight ? 80 : 30))
  }
  const area = clearArea(size, narrow, tight)
  const fitZoom = Math.min((area.x1 - area.x0) / (fs * (x1 - x0)), (area.y1 - area.y0) / (fs * (y1 - y0)))
  const z = Math.max(0.3, Math.min(1.6, fitZoom))
  const upp = 1 / (fs * z)
  const cx = (x0 + x1) / 2 - ((area.x0 + area.x1) / 2) * upp + (size.w * upp) / 2
  const cy = (y0 + y1) / 2 - ((area.y0 + area.y1) / 2) * upp + (size.h * upp) / 2 - size.h * upp * k
  return { center: [cx, cy], zoom: z }
}

// Where to point the camera, and how far in, so every answer to an open
// question sits in the clear part of the screen. Leaves the shot alone when
// they already do; otherwise recentres on them and zooms out as needed.
function fitMarkers(
  asks: Marker[],
  base: { center: [number, number]; zoom: number },
  size: { w: number; h: number },
  fs: number,
  k: number,
  narrow: boolean,
  tight = false,
): { center: [number, number]; zoom: number } {
  const { center, zoom } = base
  if (asks.length === 0) return base

  // The pins' extent in scene units (see MarkerPin: the tag sits above the point).
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity
  for (const m of asks) {
    const [sx, sy] = project(m.at)
    const half = (m.label.length * 7.6 + 28) / 2 + 8
    x0 = Math.min(x0, sx - half)
    x1 = Math.max(x1, sx + half)
    y0 = Math.min(y0, sy - 52)
    y1 = Math.max(y1, sy + 12)
  }

  const area = clearArea(size, narrow, tight)
  // Scene point → screen pixel for a camera at (cx, cy) and zoom z.
  const toScreen = (cx: number, cy: number, z: number, x: number, y: number) => {
    const upp = 1 / (fs * z)
    const left = cx - (size.w * upp) / 2
    const top = cy - (size.h * upp) / 2 + size.h * upp * k
    return [(x - left) / upp, (y - top) / upp]
  }
  const [ax, ay] = toScreen(center[0], center[1], zoom, x0, y0)
  const [bx, by] = toScreen(center[0], center[1], zoom, x1, y1)
  if (ax >= area.x0 && bx <= area.x1 && ay >= area.y0 && by <= area.y1) return { center, zoom }

  const fitZoom = Math.min((area.x1 - area.x0) / (fs * (x1 - x0)), (area.y1 - area.y0) / (fs * (y1 - y0)))
  const z = Math.max(0.3, Math.min(zoom, fitZoom))
  const upp = 1 / (fs * z)
  // Put the middle of the pins in the middle of the clear area.
  const cx = (x0 + x1) / 2 - ((area.x0 + area.x1) / 2) * upp + (size.w * upp) / 2
  const cy = (y0 + y1) / 2 - ((area.y0 + area.y1) / 2) * upp + (size.h * upp) / 2 - size.h * upp * k
  return { center: [cx, cy], zoom: z }
}
