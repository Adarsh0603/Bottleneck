import { points, project } from '../core/iso/geometry'
import { Crowd, FloorPath, IsoBox } from '../core/iso/primitives'
import type { V3 } from '../core/types'
import { useMedia } from '../core/useMedia'

// A small looping picture for the top of the list page: users sending
// requests through a load balancer to three servers. Decorative only.

const LB: V3 = [-1.6, 0, 0]
const SERVER_X = 2.2
const SERVERS_Z = [-1.6, 0, 1.6]
const CUBE = 0.22
const FLY_Y = 0.45
const TRIP_SECONDS = 2.4

// On-screen path for one request: crowd → load balancer → a server.
function tripPath(serverZ: number) {
  const stops: V3[] = [
    [-4, FLY_Y, 0],
    [LB[0] - 0.6, FLY_Y, 0],
    [LB[0] + 0.6, FLY_Y, 0],
    [SERVER_X - 0.6, FLY_Y, serverZ],
  ]
  const [first, ...rest] = stops.map((p) => project(p))
  return `M ${first.join(' ')} ${rest.map((p) => `L ${p.join(' ')}`).join(' ')}`
}

export default function HeroScene() {
  const still = useMedia('(prefers-reduced-motion: reduce)')

  return (
    <svg viewBox="-235 -175 410 305" className="h-auto w-full" aria-hidden="true">
      <FloorPath route={[[-4, 0, 0], [LB[0] - 0.6, 0, 0]]} />
      {SERVERS_Z.map((z) => (
        <FloorPath key={z} route={[[LB[0] + 0.6, 0, 0], [SERVER_X - 0.6, 0, z]]} />
      ))}

      {/* Back to front: servers (farthest first), load balancer, users. */}
      {SERVERS_Z.map((z) => (
        <Server key={z} z={z} />
      ))}
      <IsoBox x={LB[0]} z={LB[2]} w={1.2} d={1.2} h={0.45} fill="var(--fg)" />
      <Crowd x={-5} active={9} />

      {/* Requests: each server gets a steady stream, staggered so they take turns. */}
      {SERVERS_Z.flatMap((z, s) =>
        [0, 1].map((k) => {
          const begin = (s * TRIP_SECONDS) / 3 + k * (TRIP_SECONDS / 2)
          if (still) {
            // Frozen part-way along the load balancer → server leg.
            const t = 0.3 + 0.4 * k
            const [x, y] = project([LB[0] + 0.6 + (SERVER_X - 0.6 - (LB[0] + 0.6)) * t, FLY_Y, z * t])
            return (
              <g key={`${z}-${k}`} transform={`translate(${x} ${y})`}>
                <Cube />
              </g>
            )
          }
          return (
            <g key={`${z}-${k}`} opacity={0}>
              <Cube />
              <animateMotion dur={`${TRIP_SECONDS}s`} begin={`${begin}s`} repeatCount="indefinite" path={tripPath(z)} />
              <animate attributeName="opacity" values="0;1;1;0" keyTimes="0;0.1;0.9;1" dur={`${TRIP_SECONDS}s`} begin={`${begin}s`} repeatCount="indefinite" />
            </g>
          )
        }),
      )}
    </svg>
  )
}

// A request cube drawn around the origin, to be moved into place.
function Cube() {
  return <IsoBox x={0} z={0} y={-CUBE / 2} w={CUBE} d={CUBE} h={CUBE} fill="var(--fg)" />
}

function Server({ z }: { z: number }) {
  const w = 1.1
  const h = 1.5
  const x0 = SERVER_X - w / 2
  return (
    <g>
      <IsoBox x={SERVER_X} z={z} w={w} d={w} h={h} />
      {[0.35, 0.65, 0.95, 1.25].map((y) => (
        <polyline
          key={y}
          points={points([
            [x0, y, z - w * 0.3],
            [x0, y, z + w * 0.3],
          ])}
          stroke="var(--line)"
          strokeWidth={2.5}
          strokeLinecap="round"
        />
      ))}
    </g>
  )
}
