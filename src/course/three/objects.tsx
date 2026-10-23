import { Edges, Html, Line } from '@react-three/drei'
import { useFrame, type ThreeEvent } from '@react-three/fiber'
import { useMemo, useRef, type ReactNode } from 'react'
import { Object3D, type Group, type InstancedMesh, type Mesh } from 'three'
import type { LoadBalancerSim, Server } from '../../simulators/loadBalancer/engine'
import { MS_PER_TICK, TICKS_PER_SECOND } from '../../simulators/loadBalancer/useSim'
import type { ThemeColors } from '../useThemeColors'
import {
  BASE,
  CUBE,
  dropOrigin,
  dropPoint,
  FALL_SECONDS,
  LB_SIZE,
  LB_X,
  PATH_START,
  queueSpot,
  scaleOf,
  SERVER_X,
  serverFront,
  serverZ,
  SLOT,
  transitPoint,
  USERS_X,
} from '../world'

const body = (c: ThemeColors) => (c.dark ? '#141414' : '#ffffff')
const deadBody = (c: ThemeColors) => (c.dark ? '#0b0b0b' : '#e4e4e4')

// Ease a value toward its goal at a frame-rate independent speed.
const approach = (from: number, to: number, dt: number, speed = 4) => from + (to - from) * (1 - Math.exp(-dt * speed))

export function Tag({
  position,
  danger,
  children,
}: {
  position: [number, number, number]
  danger?: boolean
  children: ReactNode
}) {
  return (
    <Html position={position} center zIndexRange={[10, 0]}>
      <div className="tag-in pointer-events-none flex flex-col items-center">
        <div
          className={`whitespace-nowrap rounded-full border px-3 py-1 font-mono text-[11px] uppercase tracking-wider shadow-sm ${
            danger ? 'border-danger bg-danger text-bg' : 'border-fg bg-bg text-fg'
          }`}
        >
          {children}
        </div>
        <div className={`h-4 w-px ${danger ? 'bg-danger' : 'bg-fg'}`} />
      </div>
    </Html>
  )
}

// Rises out of the floor on mount, then glides to wherever it is placed.
function useRiser(goal: { z: number; scale: number; tilt: number }) {
  const ref = useRef<Group>(null)
  const ready = useRef(false)
  useFrame((_, dt) => {
    const g = ref.current
    if (!g) return
    if (!ready.current) {
      g.position.set(0, -BASE.h * goal.scale - 0.4, goal.z)
      g.scale.setScalar(goal.scale)
      ready.current = true
    }
    g.position.y = approach(g.position.y, 0, dt, 3.5)
    g.position.z = approach(g.position.z, goal.z, dt)
    g.scale.setScalar(approach(g.scale.x, goal.scale, dt, 3))
    g.rotation.z = approach(g.rotation.z, goal.tilt, dt, 6)
  })
  return ref
}

export function Server3D({
  server,
  index,
  count,
  queueLimit,
  overloaded,
  colors,
  tags,
  onClick,
}: {
  server: Server
  index: number
  count: number
  queueLimit: number
  overloaded: boolean
  colors: ThemeColors
  tags: { label: string; danger?: boolean; at?: 'top' | 'queue' | 'end' }[]
  onClick?: () => void
}) {
  const z = serverZ(index, count)
  const k = scaleOf(server.speed)
  const ref = useRiser({ z, scale: k, tilt: server.alive ? 0 : -0.12 })
  const edge = !server.alive ? colors.muted : overloaded ? colors.danger : colors.fg

  const click = (e: ThreeEvent<MouseEvent>) => {
    if (!onClick || e.delta > 4) return
    e.stopPropagation()
    onClick()
  }

  return (
    <>
      <group position-x={SERVER_X}>
        <group ref={ref}>
          <mesh
            position-y={BASE.h / 2}
            castShadow
            receiveShadow
            onClick={click}
            onPointerOver={() => onClick && (document.body.style.cursor = 'pointer')}
            onPointerOut={() => (document.body.style.cursor = '')}
          >
            <boxGeometry args={[BASE.w, BASE.h, BASE.d]} />
            <meshStandardMaterial color={server.alive ? body(colors) : deadBody(colors)} roughness={0.85} />
            <Edges color={edge} />
          </mesh>

          {/* Rack vents on the front, so it reads as a server. */}
          {[0.4, 0.75, 1.1, 1.45].map((y) => (
            <mesh key={y} position={[-BASE.w / 2 - 0.002, y, 0]} rotation-y={-Math.PI / 2}>
              <planeGeometry args={[BASE.d * 0.65, 0.07]} />
              <meshBasicMaterial color={colors.line} />
            </mesh>
          ))}

          {/* Worker slots on top: lit while handling a request. */}
          {server.alive &&
            Array.from({ length: server.slots }, (_, s) => (
              <mesh
                key={s}
                position={[((s % 2) - 0.5) * 0.56, BASE.h + SLOT / 2 + 0.02, (Math.floor(s / 2) - 0.5) * 0.56]}
                castShadow
              >
                <boxGeometry args={[SLOT, SLOT, SLOT]} />
                <meshStandardMaterial color={s < server.active.length ? colors.fg : body(colors)} />
                <Edges color={colors.fg} />
              </mesh>
            ))}

          {tags
            .filter((t) => (t.at ?? 'top') === 'top')
            .map((t, i) => (
              <Tag key={t.label} position={[0, BASE.h + 1 + i * 0.55, 0]} danger={t.danger}>
                {t.label}
              </Tag>
            ))}
        </group>
      </group>

      {/* The queue: marked floor spots, and the requests waiting on them. */}
      {Array.from({ length: queueLimit }, (_, i) => {
        const [x, , qz] = queueSpot(server.speed, index, count, i)
        return (
          <mesh key={i} position={[x, 0.004, qz]} rotation-x={-Math.PI / 2}>
            <planeGeometry args={[CUBE + 0.08, CUBE + 0.08]} />
            <meshBasicMaterial color={colors.subtle} />
            <Edges color={colors.line} />
          </mesh>
        )
      })}
      {server.queue.map((job, i) => (
        <mesh key={job.id} position={queueSpot(server.speed, index, count, i)} castShadow>
          <boxGeometry args={[CUBE, CUBE, CUBE]} />
          <meshStandardMaterial color={overloaded ? colors.danger : colors.fg} />
        </mesh>
      ))}

      {tags
        .filter((t) => t.at === 'queue')
        .map((t) => (
          <Tag key={t.label} position={[queueSpot(server.speed, index, count, (queueLimit - 1) / 2)[0], 0.85, z]} danger={t.danger}>
            {t.label}
          </Tag>
        ))}
      {tags
        .filter((t) => t.at === 'end')
        .map((t) => (
          <Tag key={t.label} position={[queueSpot(server.speed, index, count, queueLimit)[0] - 0.4, 1.3, z]} danger={t.danger}>
            {t.label}
          </Tag>
        ))}
    </>
  )
}

export function LoadBalancer3D({
  z,
  mode,
  colors,
  tag,
}: {
  z: number
  mode: 'active' | 'standby' | 'down'
  colors: ThemeColors
  tag?: { label: string; danger?: boolean }
}) {
  const ref = useRiser({ z, scale: 1, tilt: mode === 'down' ? -0.15 : 0 })
  const fill = mode === 'active' ? colors.fg : mode === 'down' ? deadBody(colors) : body(colors)

  return (
    <group position-x={LB_X}>
      <group ref={ref}>
        <mesh position-y={LB_SIZE.h / 2} castShadow receiveShadow>
          <boxGeometry args={[LB_SIZE.w, LB_SIZE.h, LB_SIZE.d]} />
          <meshStandardMaterial color={fill} roughness={0.6} transparent={mode === 'standby'} opacity={mode === 'standby' ? 0.55 : 1} />
          <Edges color={mode === 'down' ? colors.muted : colors.fg} />
        </mesh>
        {/* A fork arrow on top: one stream in, many out. */}
        {mode === 'active' && (
          <group position-y={LB_SIZE.h + 0.01}>
            <mesh position={[-0.28, 0, 0]}>
              <boxGeometry args={[0.5, 0.02, 0.07]} />
              <meshBasicMaterial color={colors.bg} />
            </mesh>
            {[-0.6, 0, 0.6].map((angle) => (
              <mesh key={angle} position={[0.2, 0, Math.sin(angle) * 0.16]} rotation-y={-angle}>
                <boxGeometry args={[0.42, 0.02, 0.07]} />
                <meshBasicMaterial color={colors.bg} />
              </mesh>
            ))}
          </group>
        )}
        {mode === 'down' && (
          <Tag position={[0, 1.1, 0]} danger>
            Down
          </Tag>
        )}
        {tag && mode !== 'down' && (
          <Tag position={[0, 1.1, 0]} danger={tag.danger}>
            {tag.label}
          </Tag>
        )}
      </group>
    </group>
  )
}

const COLS = 4
const ROWS = 3

// A crowd of little people. One more lights up per request per second.
export function Users3D({ rps, colors, tagged }: { rps: number; colors: ThemeColors; tagged: boolean }) {
  const active = Math.round(rps)
  const idle = colors.dark ? '#2a2a2a' : '#d6d6d6'

  return (
    <group position={[USERS_X, 0, 0]}>
      <mesh position-y={0.03} receiveShadow>
        <boxGeometry args={[1.9, 0.06, 1.6]} />
        <meshStandardMaterial color={body(colors)} />
        <Edges color={colors.line} />
      </mesh>
      {Array.from({ length: COLS * ROWS }, (_, i) => {
        const x = ((i % COLS) - (COLS - 1) / 2) * 0.42
        const z = (Math.floor(i / COLS) - (ROWS - 1) / 2) * 0.45
        const color = i < active ? colors.fg : idle
        return (
          <group key={i} position={[x, 0.06, z]}>
            <mesh position-y={0.2} castShadow>
              <cylinderGeometry args={[0.09, 0.11, 0.4, 16]} />
              <meshStandardMaterial color={color} />
            </mesh>
            <mesh position-y={0.5} castShadow>
              <sphereGeometry args={[0.1, 16, 16]} />
              <meshStandardMaterial color={color} />
            </mesh>
          </group>
        )
      })}
      {tagged && <Tag position={[0, 1.4, 0]}>Users</Tag>}
    </group>
  )
}

// Dashed routes painted on the floor.
export function FloorPaths({ sim, lbz, colors }: { sim: LoadBalancerSim; lbz: number; colors: ThemeColors }) {
  const count = sim.servers.length
  const direct = sim.algorithm === 'direct'
  const routes: [number, number, number][][] = direct
    ? sim.servers.slice(0, 1).map((s) => [
        [PATH_START, 0.01, 0],
        [serverFront(s.speed), 0.01, serverZ(0, count)],
      ])
    : [
        [
          [PATH_START, 0.01, 0],
          [LB_X - LB_SIZE.w / 2, 0.01, lbz],
        ],
        ...sim.servers.map((s, i): [number, number, number][] => [
          [LB_X + LB_SIZE.w / 2, 0.01, lbz],
          [serverFront(s.speed), 0.01, serverZ(i, count)],
        ]),
      ]
  return (
    <>
      {routes.map((points, i) => (
        <Line key={`${i}-${points.flat().join(',')}`} points={points} color={colors.muted} lineWidth={1} dashed dashSize={0.15} gapSize={0.12} />
      ))}
    </>
  )
}

const MAX = 256

// Requests in flight and requests being dropped, drawn every frame straight
// from the simulation and interpolated between its 20 Hz ticks.
export function Requests({
  simRef,
  lastTickAt,
  lbz,
  colors,
}: {
  simRef: { current: LoadBalancerSim | null }
  lastTickAt: { current: number }
  lbz: number
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
      const at = transitPoint(sim, t, p, lbz)
      if (!at) continue
      dummy.position.set(...at)
      dummy.rotation.set(0, p * Math.PI, 0)
      dummy.scale.setScalar(1)
      dummy.updateMatrix()
      fly.setMatrixAt(n++, dummy.matrix)
    }
    fly.count = n
    fly.instanceMatrix.needsUpdate = true

    let m = 0
    for (const d of sim.recentDrops) {
      if (m >= MAX) break
      const age = (sim.tick - d.tick + frac) / TICKS_PER_SECOND
      if (age > FALL_SECONDS) continue
      dummy.position.set(...dropPoint(dropOrigin(sim, d.serverId), age, d.jobId))
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

const PULSE_PERIOD = 1.2

// Health checks: a dot goes out to each server every second and comes back if
// the server answers. A dead server's dot turns red and never returns.
export function HealthPulses({ sim, lbz, colors }: { sim: LoadBalancerSim; lbz: number; colors: ThemeColors }) {
  return (
    <>
      {sim.servers.map((s, i) => (
        <Pulse
          key={s.id}
          from={[LB_X + LB_SIZE.w / 2, 0.3, lbz]}
          to={[serverFront(s.speed), 0.3, serverZ(i, sim.servers.length)]}
          alive={s.alive}
          offset={i * 0.12}
          colors={colors}
        />
      ))}
    </>
  )
}

function Pulse({
  from,
  to,
  alive,
  offset,
  colors,
}: {
  from: [number, number, number]
  to: [number, number, number]
  alive: boolean
  offset: number
  colors: ThemeColors
}) {
  const ref = useRef<Mesh>(null)
  useFrame(({ clock }) => {
    const mesh = ref.current
    if (!mesh) return
    const phase = ((clock.elapsedTime + offset) % PULSE_PERIOD) / PULSE_PERIOD
    const out = phase < 0.5
    const t = out ? phase * 2 : 1 - (phase - 0.5) * 2
    mesh.visible = out || alive
    mesh.position.set(from[0] + (to[0] - from[0]) * t, from[1], from[2] + (to[2] - from[2]) * t)
  })
  return (
    <mesh ref={ref}>
      <sphereGeometry args={[0.08, 12, 12]} />
      <meshBasicMaterial color={alive ? colors.muted : colors.danger} />
    </mesh>
  )
}

// The biggest machine you can buy, drawn as an empty outline.
export function Ceiling({ colors }: { colors: ThemeColors }) {
  const k = scaleOf(8)
  return (
    <group position={[SERVER_X, (BASE.h * k) / 2, 0]}>
      <mesh>
        <boxGeometry args={[BASE.w * k, BASE.h * k, BASE.d * k]} />
        <meshBasicMaterial color={colors.fg} transparent opacity={0.03} depthWrite={false} />
        <Edges color={colors.muted} />
      </mesh>
      <Tag position={[0, (BASE.h * k) / 2 + 0.6, 0]}>Biggest machine sold</Tag>
    </group>
  )
}
