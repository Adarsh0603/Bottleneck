import { Grid, OrbitControls } from '@react-three/drei'
import { Canvas, useThree } from '@react-three/fiber'
import { useEffect, type ReactNode } from 'react'
import type { ThemeColors } from './useThemeColors'

// Keep the whole scene in frame on any screen size.
function FitZoom() {
  const { camera, size } = useThree()
  useEffect(() => {
    camera.zoom = Math.max(26, Math.min(size.width / 13, size.height / 7.5))
    camera.updateProjectionMatrix()
  }, [camera, size])
  return null
}

export default function Stage({ colors, children }: { colors: ThemeColors; children: ReactNode }) {
  return (
    <Canvas orthographic shadows dpr={[1, 2]} camera={{ position: [9, 8, 11], zoom: 60, near: -100, far: 200 }}>
      <color attach="background" args={[colors.bg]} />
      <FitZoom />

      <ambientLight intensity={colors.dark ? 0.9 : 1.7} />
      <directionalLight
        position={[6, 12, 8]}
        intensity={colors.dark ? 1.6 : 1.9}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-12}
        shadow-camera-right={12}
        shadow-camera-top={12}
        shadow-camera-bottom={-12}
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
        fadeDistance={40}
        fadeStrength={1.4}
      />

      <OrbitControls
        makeDefault
        target={[-1, 0.6, 0]}
        enablePan={false}
        enableZoom={false}
        enableDamping
        minPolarAngle={0.55}
        maxPolarAngle={1.25}
        minAzimuthAngle={0.05}
        maxAzimuthAngle={1.45}
      />

      {children}
    </Canvas>
  )
}
