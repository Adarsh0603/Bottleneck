import { Html } from '@react-three/drei'
import type { ReactNode } from 'react'

// A small label pinned to a point in the 3D scene.
export default function Tag({
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
