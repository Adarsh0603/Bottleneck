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
    const id = setInterval(() => {
      simRef.current!.step()
      lastTickAt.current = performance.now()
      setFrame((f) => f + 1)
    }, 1000 / ticksPerSecond)
    return () => clearInterval(id)
  }, [ticksPerSecond, paused])

  return { sim: simRef.current, simRef, lastTickAt }
}
