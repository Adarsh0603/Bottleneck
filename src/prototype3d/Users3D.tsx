import { Edges } from '@react-three/drei'
import { USERS_X } from './layout'
import Tag from './Tag'
import type { ThemeColors } from './useThemeColors'

const COLS = 4
const ROWS = 3

// A crowd of little people. One more lights up per request per second.
export default function Users3D({ rps, colors, tagged }: { rps: number; colors: ThemeColors; tagged: boolean }) {
  const active = Math.round(rps)
  const idle = colors.dark ? '#2a2a2a' : '#d6d6d6'

  return (
    <group position={[USERS_X, 0, 0]}>
      <mesh position-y={0.03} receiveShadow>
        <boxGeometry args={[1.9, 0.06, 1.6]} />
        <meshStandardMaterial color={colors.dark ? '#141414' : '#ffffff'} />
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
