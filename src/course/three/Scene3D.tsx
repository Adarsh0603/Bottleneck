import { Grid, OrbitControls } from '@react-three/drei'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import { Vector3 } from 'three'
import { buildTags } from '../tags'
import type { SceneProps, Shot } from '../types'
import { useThemeColors } from '../useThemeColors'
import { isOverloaded, lbZ, STANDBY_Z } from '../world'
import { Ceiling, FloorPaths, HealthPulses, LoadBalancer3D, Requests, Server3D, Users3D } from './objects'

interface Controls {
  target: Vector3
  addEventListener: (type: 'start', fn: () => void) => void
  removeEventListener: (type: 'start', fn: () => void) => void
}

// Glides the camera to each beat's shot, and shakes it when something crashes.
// If the viewer drags to look around, it stops steering until the next shot.
function CameraRig({ shot, zoomFactor, shake }: { shot: Shot; zoomFactor: number; shake: number }) {
  const camera = useThree((s) => s.camera)
  const size = useThree((s) => s.size)
  const controls = useThree((s) => s.controls) as unknown as Controls | null
  const base = Math.max(22, Math.min(size.width / 14, size.height / 8.5))
  const goalZoom = base * shot.zoom * zoomFactor
  const goal = useMemo(() => new Vector3(...shot.target), [shot])

  const steering = useRef(true)
  const shakeUntil = useRef(0)
  const offset = useRef(new Vector3())

  useEffect(() => {
    steering.current = true
  }, [goal, goalZoom])

  useEffect(() => {
    if (shake > 0) shakeUntil.current = performance.now() + 380
  }, [shake])

  useEffect(() => {
    if (!controls) return
    const stop = () => {
      steering.current = false
    }
    controls.addEventListener('start', stop)
    return () => controls.removeEventListener('start', stop)
  }, [controls])

  useFrame((_, dt) => {
    if (!controls) return
    camera.position.sub(offset.current)

    if (steering.current) {
      const a = 1 - Math.exp(-dt * 3)
      const dir = camera.position.clone().sub(controls.target).normalize()
      controls.target.lerp(goal, a)
      camera.position.copy(controls.target).addScaledVector(dir, 30)
      camera.zoom += (goalZoom - camera.zoom) * a
      camera.updateProjectionMatrix()
      if (controls.target.distanceTo(goal) < 0.005 && Math.abs(camera.zoom - goalZoom) < 0.05) steering.current = false
    }

    if (performance.now() < shakeUntil.current) {
      offset.current.set((Math.random() - 0.5) * 0.3, (Math.random() - 0.5) * 0.3, 0)
    } else {
      offset.current.set(0, 0, 0)
    }
    camera.position.add(offset.current)
  })

  return null
}

export default function Scene3D({ simRef, lastTickAt, st, beat, shot, shake, onServerClick }: SceneProps) {
  const colors = useThemeColors()
  const sim = simRef.current
  if (!sim) return null

  const count = sim.servers.length
  const lbz = lbZ(st.failover)
  const balancer = sim.algorithm !== 'direct'
  const tags = buildTags(sim, beat)
  const extent = ((count - 1) * 2.3) / 2 + 0.75
  const zoomFactor = shot.fit ? Math.min(1, 4.2 / extent) : 1

  return (
    <Canvas orthographic shadows dpr={[1, 2]} camera={{ position: [9, 8, 11], zoom: 40, near: -100, far: 200 }}>
      <color attach="background" args={[colors.bg]} />

      <ambientLight intensity={colors.dark ? 0.9 : 1.7} />
      <directionalLight
        position={[6, 12, 8]}
        intensity={colors.dark ? 1.6 : 1.9}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-14}
        shadow-camera-right={14}
        shadow-camera-top={14}
        shadow-camera-bottom={-14}
      />
      <mesh rotation-x={-Math.PI / 2} position-y={-0.002} receiveShadow>
        <planeGeometry args={[80, 80]} />
        <shadowMaterial opacity={colors.dark ? 0.5 : 0.1} />
      </mesh>
      <Grid
        infiniteGrid
        cellSize={0.5}
        cellThickness={0.6}
        cellColor={colors.line}
        sectionSize={2.5}
        sectionThickness={1}
        sectionColor={colors.muted}
        fadeDistance={45}
        fadeStrength={1.4}
      />

      <OrbitControls
        makeDefault
        enablePan={false}
        enableZoom={false}
        enableDamping
        minPolarAngle={0.55}
        maxPolarAngle={1.25}
        minAzimuthAngle={0.05}
        maxAzimuthAngle={1.45}
      />
      <CameraRig shot={shot} zoomFactor={zoomFactor} shake={shake} />

      <FloorPaths sim={sim} lbz={lbz} colors={colors} />
      <Users3D rps={st.rps} colors={colors} tagged={tags.users} />

      {balancer && <LoadBalancer3D z={0} mode={st.failover ? 'down' : 'active'} colors={colors} tag={tags.lb} />}
      {balancer && st.standby && (
        <LoadBalancer3D
          z={STANDBY_Z}
          mode={st.failover ? 'active' : 'standby'}
          colors={colors}
          tag={st.failover ? tags.lb : tags.standby}
        />
      )}

      {sim.servers.map((server, i) => (
        <Server3D
          key={server.id}
          server={server}
          index={i}
          count={count}
          queueLimit={sim.config.queueLimit}
          overloaded={isOverloaded(server, sim.config.queueLimit)}
          colors={colors}
          tags={tags.servers[i]}
          onClick={beat.clickCrash && onServerClick ? () => onServerClick(i) : undefined}
        />
      ))}

      <Requests simRef={simRef} lastTickAt={lastTickAt} lbz={lbz} colors={colors} />
      {beat.pulses && balancer && <HealthPulses sim={sim} lbz={lbz} colors={colors} />}
      {beat.ghost && <Ceiling colors={colors} />}
    </Canvas>
  )
}
