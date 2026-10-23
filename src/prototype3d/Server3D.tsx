import { Edges } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { useRef } from 'react'
import type { Group } from 'three'
import type { Server } from '../simulators/loadBalancer/engine'
import { BOX, CUBE, queueSpot, SERVER_X } from './layout'
import Tag from './Tag'
import type { ThemeColors } from './useThemeColors'

export type ServerTag = 'server' | 'workers' | 'queue' | 'dropped'

const SLOT = 0.36

export default function Server3D({
  server,
  queueLimit,
  colors,
  tags,
}: {
  server: Server
  queueLimit: number
  colors: ThemeColors
  tags: ServerTag[]
}) {
  const group = useRef<Group>(null)

  // Rise out of the floor when first shown.
  useFrame((_, dt) => {
    const g = group.current
    if (g && g.position.y < 0) g.position.y = Math.min(0, g.position.y + (0.02 - g.position.y) * Math.min(1, dt * 3.5))
  })

  const overloaded = server.queue.length >= queueLimit * 0.75
  const edge = overloaded ? colors.danger : colors.fg
  const body = colors.dark ? '#141414' : '#ffffff'

  return (
    <>
      <group ref={group} position={[SERVER_X, -BOX.h - 0.3, 0]}>
        <mesh position-y={BOX.h / 2} castShadow receiveShadow>
          <boxGeometry args={[BOX.w, BOX.h, BOX.d]} />
          <meshStandardMaterial color={body} roughness={0.85} />
          <Edges color={edge} />
        </mesh>

        {/* Rack vents on the front face, so it reads as a server. */}
        {[0.45, 0.8, 1.15, 1.5].map((y) => (
          <mesh key={y} position={[-BOX.w / 2 - 0.002, y, 0]} rotation-y={-Math.PI / 2}>
            <planeGeometry args={[BOX.d * 0.65, 0.07]} />
            <meshBasicMaterial color={colors.line} />
          </mesh>
        ))}

        {/* Worker slots on top: lit while a request is being handled. */}
        {Array.from({ length: server.slots }, (_, k) => {
          const busy = k < server.active.length
          return (
            <mesh
              key={k}
              position={[((k % 2) - 0.5) * 0.6, BOX.h + SLOT / 2 + 0.02, (Math.floor(k / 2) - 0.5) * 0.6]}
              castShadow
            >
              <boxGeometry args={[SLOT, SLOT, SLOT]} />
              <meshStandardMaterial color={busy ? colors.fg : body} />
              <Edges color={colors.fg} />
            </mesh>
          )
        })}

        {tags.includes('server') && <Tag position={[0, BOX.h + 1.1, 0]}>Server</Tag>}
        {tags.includes('workers') && <Tag position={[0, BOX.h + 1.1, 0]}>{server.slots} workers</Tag>}
      </group>

      {/* Spots on the floor for the queue, and the requests waiting in them. */}
      {Array.from({ length: queueLimit }, (_, i) => {
        const [x, , z] = queueSpot(i)
        return (
          <mesh key={i} position={[x, 0.004, z]} rotation-x={-Math.PI / 2}>
            <planeGeometry args={[CUBE + 0.08, CUBE + 0.08]} />
            <meshBasicMaterial color={colors.subtle} />
            <Edges color={colors.line} />
          </mesh>
        )
      })}
      {server.queue.map((job, i) => (
        <mesh key={job.id} position={queueSpot(i)} castShadow>
          <boxGeometry args={[CUBE, CUBE, CUBE]} />
          <meshStandardMaterial color={overloaded ? colors.danger : colors.fg} />
        </mesh>
      ))}

      {tags.includes('queue') && (
        <Tag position={[queueSpot((queueLimit - 1) / 2)[0], 0.9, 0]} danger={overloaded}>
          Queue · {server.queue.length}/{queueLimit}
        </Tag>
      )}
      {tags.includes('dropped') && overloaded && (
        <Tag position={[queueSpot(queueLimit)[0] - 0.3, 1.3, 0]} danger>
          Dropped
        </Tag>
      )}
    </>
  )
}
