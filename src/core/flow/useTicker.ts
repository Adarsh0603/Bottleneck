import { useEffect, useRef, useState } from 'react'

// Runs any simulation with a step() method at a fixed rate and re-renders
// after each tick. lastTickAt lets scenes interpolate between ticks. While
// `paused`, it stops stepping.
export function useTicker<Sim extends { step(): void }>(create: () => Sim, ticksPerSecond = 20, paused = false) {
  const simRef = useRef<Sim | null>(null)
  if (!simRef.current) simRef.current = create()
  const lastTickAt = useRef(0)
  const [, setFrame] = useState(0)

  useEffect(() => {
    if (paused) return
    const interval = 1000 / ticksPerSecond
    const id = setInterval(() => {
      simRef.current!.step()
      // Keep a steady beat: setInterval fires a little early or late, and
      // stamping the real time would make cubes stall, then jump.
      const now = performance.now()
      const beat = lastTickAt.current + interval
      lastTickAt.current = Math.abs(now - beat) > interval ? now : beat
      setFrame((f) => f + 1)
    }, interval)
    return () => clearInterval(id)
  }, [ticksPerSecond, paused])

  return { sim: simRef.current, simRef, lastTickAt }
}
