import { useEffect, useRef, useState, type CSSProperties, type ElementType, type FocusEvent, type PointerEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

const DELAY = 300 // ms the pointer rests on something before its tooltip shows
const EDGE = 8 // px kept clear of the screen edge
const HALF = 110 // half the widest a tooltip gets, for keeping it on screen

interface Spot {
  x: number
  y: number
  below: boolean
}

// A small tooltip in place of the browser's own. The wrapper takes the styling of the element it
// stands for, so wrap the thing that should show it and move that thing's layout classes here.
export default function Tooltip({
  text,
  children,
  as: Tag = 'span',
  className,
  style,
}: {
  text?: string
  children: ReactNode
  as?: ElementType
  className?: string
  style?: CSSProperties
}) {
  const [spot, setSpot] = useState<Spot | null>(null)
  const box = useRef<HTMLElement>(null)
  const timer = useRef<number>(0)

  const hide = () => {
    window.clearTimeout(timer.current)
    setSpot(null)
  }
  const show = (wait: number) => {
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => {
      const r = box.current?.getBoundingClientRect()
      if (!r) return
      const x = Math.min(window.innerWidth - EDGE - HALF, Math.max(EDGE + HALF, r.left + r.width / 2))
      setSpot({ x, y: r.top < 48 ? r.bottom + 8 : r.top - 8, below: r.top < 48 })
    }, wait)
  }

  useEffect(() => {
    if (!spot) return
    const off = () => setSpot(null)
    const escape = (e: KeyboardEvent) => e.key === 'Escape' && off()
    window.addEventListener('scroll', off, true)
    window.addEventListener('keydown', escape)
    return () => {
      window.removeEventListener('scroll', off, true)
      window.removeEventListener('keydown', escape)
    }
  }, [spot])
  useEffect(() => () => window.clearTimeout(timer.current), [])

  if (!text) return <Tag className={className} style={style}>{children}</Tag>

  return (
    <Tag
      ref={box}
      className={className}
      style={style}
      onPointerEnter={(e: PointerEvent) => e.pointerType === 'mouse' && show(DELAY)}
      onPointerLeave={hide}
      onPointerDown={hide}
      onFocus={(e: FocusEvent) => (e.target as HTMLElement).matches(':focus-visible') && show(0)}
      onBlur={hide}
    >
      {children}
      {spot &&
        createPortal(
          <span
            role="tooltip"
            className="pointer-events-none fixed z-[100] max-w-[220px] rounded-md bg-fg px-2 py-1 text-center font-mono text-[11px] leading-snug text-bg shadow-md"
            style={{ left: spot.x, top: spot.y, transform: `translate(-50%, ${spot.below ? '0' : '-100%'})` }}
          >
            {text}
          </span>,
          document.body,
        )}
    </Tag>
  )
}
