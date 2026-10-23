import { useFrame } from '@react-three/fiber'
import { useMemo, useRef, type RefObject } from 'react'
import { Object3D, type InstancedMesh } from 'three'
import type { LoadBalancerSim } from '../simulators/loadBalancer/engine'
import { MS_PER_TICK, TICKS_PER_SECOND } from '../simulators/loadBalancer/useSim'
import { CUBE, FLY_Y, PATH_START, queueSpot, SERVER_FRONT } from './layout'
import type { ThemeColors } from './useThemeColors'

const MAX = 256
const FALL_SECONDS = 1.4

// Requests in flight and requests being dropped, drawn every frame straight
// from the simulation and interpolated between its 20 Hz ticks.
export default function Requests({
  simRef,
  lastTickAt,
  colors,
}: {
  simRef: RefObject<LoadBalancerSim | null>
  lastTickAt: RefObject<number>
  colors: ThemeColors
}) {
  const flying = useRef<InstancedMesh>(null)
  const falling = useRef<InstancedMesh>(null)
  const dummy = useMemo(() => new Object3D(), [])

  useFrame(() => {
    const sim = simRef.current
    const fly = flying.current
    const fall = falling.current
    if (!sim || !fly || !fall) return
    const frac = Math.min(1, (performance.now() - lastTickAt.current) / MS_PER_TICK)

    let n = 0
    for (const t of sim.inTransit) {
      if (n >= MAX) break
      const p = Math.min(1, t.progress + frac / sim.config.transitTicks)
      const jitter = (((t.job.id * 37) % 7) - 3) * 0.07
      dummy.position.set(
        PATH_START + (SERVER_FRONT - 0.2 - PATH_START) * p,
        FLY_Y + Math.sin(p * Math.PI) * 0.35,
        jitter,
      )
      dummy.rotation.set(0, p * Math.PI, 0)
      dummy.scale.setScalar(1)
      dummy.updateMatrix()
      fly.setMatrixAt(n++, dummy.matrix)
    }
    fly.count = n
    fly.instanceMatrix.needsUpdate = true

    // Dropped requests tumble off the end of the queue and fall through the floor.
    const [endX] = queueSpot(sim.config.queueLimit)
    let m = 0
    for (const d of sim.recentDrops) {
      if (m >= MAX) break
      const age = (sim.tick - d.tick + frac) / TICKS_PER_SECOND
      if (age > FALL_SECONDS) continue
      const side = d.jobId % 2 === 0 ? 1 : -1
      const x = d.serverId === undefined ? PATH_START : endX
      dummy.position.set(x - age * 0.6, FLY_Y + age * 1.2 - 5 * age * age, side * (0.15 + age * 0.9))
      dummy.rotation.set(age * 5, age * 4, 0)
      dummy.scale.setScalar(Math.max(0.001, 1 - age / FALL_SECONDS))
      dummy.updateMatrix()
      fall.setMatrixAt(m++, dummy.matrix)
    }
    fall.count = m
    fall.instanceMatrix.needsUpdate = true
  })

  return (
    <>
      <instancedMesh ref={flying} args={[undefined, undefined, MAX]} frustumCulled={false} castShadow>
        <boxGeometry args={[CUBE, CUBE, CUBE]} />
        <meshStandardMaterial color={colors.fg} />
      </instancedMesh>
      <instancedMesh ref={falling} args={[undefined, undefined, MAX]} frustumCulled={false}>
        <boxGeometry args={[CUBE, CUBE, CUBE]} />
        <meshStandardMaterial color={colors.danger} />
      </instancedMesh>
    </>
  )
}
