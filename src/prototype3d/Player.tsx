import { Line } from '@react-three/drei'
import { useEffect, useState, type ReactNode } from 'react'
import IsoScene from '../prototypeIso/IsoScene'
import { Slider } from '../simulators/loadBalancer/ui'
import { capacity, useSim } from '../simulators/loadBalancer/useSim'
import { PATH_START, SERVER_FRONT } from './layout'
import Requests from './Requests'
import Server3D, { type ServerTag } from './Server3D'
import Stage from './Stage'
import Users3D from './Users3D'
import { useThemeColors } from './useThemeColors'

type Hud = 'latency' | 'queue' | 'dropped'

interface Beat {
  caption: string
  sub: string
  rps?: number
  ramp?: boolean
  slider?: boolean
  usersTag?: boolean
  tags: ServerTag[]
  hud: Hud[]
}

const RAMP_PEAK = 12

const BEATS: Beat[] = [
  { caption: 'This is a server.', sub: 'A computer that answers your app’s requests.', rps: 0, tags: ['server'], hud: [] },
  { caption: 'Users send requests.', sub: 'Each cube is one request.', rps: 1, usersTag: true, tags: [], hud: [] },
  { caption: 'Each request takes a worker.', sub: 'This server has 4.', rps: 2, tags: ['workers'], hud: ['latency'] },
  { caption: 'All busy? Requests wait in line.', sub: 'Waiting means slower responses.', rps: 3.5, tags: ['queue'], hud: ['latency', 'queue'] },
  { caption: 'Line full? Users get errors.', sub: 'Watch the traffic climb.', rps: 4, ramp: true, tags: ['queue', 'dropped'], hud: ['latency', 'queue', 'dropped'] },
  { caption: 'Every server has a limit.', sub: 'Find this one’s.', slider: true, tags: ['queue', 'dropped'], hud: ['latency', 'queue', 'dropped'] },
]

export default function Player({ mode }: { mode: '3d' | 'iso' }) {
  const colors = useThemeColors()
  const s = useSim((sim) => sim.addServer(1), 0)
  const [beat, setBeat] = useState(0)
  const [ramping, setRamping] = useState(false)
  const { rps, setRps } = s
  const b = BEATS[beat]

  const go = (i: number) => {
    const next = BEATS[i]
    setBeat(i)
    setRamping(!!next.ramp)
    if (next.rps !== undefined) setRps(next.rps)
  }

  useEffect(() => {
    if (!ramping) return
    if (rps >= RAMP_PEAK) {
      setRamping(false)
      return
    }
    const id = setTimeout(() => setRps(Math.floor(rps) + 1), 900)
    return () => clearTimeout(id)
  }, [ramping, rps, setRps])

  const server = s.sim.servers[0]
  const queueLimit = s.sim.config.queueLimit

  return (
    <div className="relative h-[calc(100svh-57px)] min-h-[560px] w-full overflow-hidden">
      {mode === '3d' ? (
        <Stage colors={colors}>
          <Line points={[[PATH_START, 0.01, 0], [SERVER_FRONT, 0.01, 0]]} color={colors.muted} lineWidth={1} dashed dashSize={0.15} gapSize={0.12} />
          <Users3D rps={rps} colors={colors} tagged={!!b.usersTag} />
          {server && <Server3D server={server} queueLimit={queueLimit} colors={colors} tags={b.tags} />}
          <Requests simRef={s.simRef} lastTickAt={s.lastTickAt} colors={colors} />
        </Stage>
      ) : (
        <div className="absolute inset-0 pb-28 pt-10">
          <IsoScene simRef={s.simRef} lastTickAt={s.lastTickAt} rps={rps} tags={b.tags} usersTag={!!b.usersTag} />
        </div>
      )}

      {/* Beat progress */}
      <div className="absolute inset-x-0 top-0 flex gap-1 px-4 pt-4">
        {BEATS.map((_, i) => (
          <button
            key={i}
            onClick={() => go(i)}
            aria-label={`Step ${i + 1}`}
            className={`h-1 flex-1 rounded-full transition ${i <= beat ? 'bg-fg' : 'bg-line'}`}
          />
        ))}
      </div>

      {/* HUD */}
      <div className="absolute left-4 top-8 flex flex-wrap gap-2">
        {b.hud.includes('latency') && (
          <Chip icon={<ClockIcon />} value={`${(s.avgMs / 1000).toFixed(1)}s`} bad={s.avgMs > 2500} />
        )}
        {b.hud.includes('queue') && (
          <Chip icon={<StackIcon />} value={`${server?.queue.length ?? 0}/${queueLimit}`} bad={(server?.queue.length ?? 0) >= queueLimit * 0.75} />
        )}
        {b.hud.includes('dropped') && <Chip icon={<CrossIcon />} value={`${s.dropRate.toFixed(0)}%`} bad={s.dropRate > 1} />}
        {rps > 0 && <Chip icon={<ArrowIcon />} value={`${rps}/s`} />}
      </div>

      {/* Caption and navigation */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-linear-to-t from-bg via-bg/85 to-transparent px-4 pb-6 pt-20">
        <div className="pointer-events-auto mx-auto flex max-w-5xl flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
          <div key={beat} className="caption-in">
            <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">{b.caption}</h2>
            <p className="mt-1 text-muted">{b.sub}</p>
            {b.slider && (
              <div className="mt-4 w-full max-w-xs">
                <Slider
                  label="Traffic"
                  value={rps}
                  min={1}
                  max={RAMP_PEAK}
                  unit="req/s"
                  hint={`Limit ≈ ${capacity(s.sim).toFixed(1)} req/s`}
                  onChange={setRps}
                />
              </div>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              onClick={() => go(beat - 1)}
              disabled={beat === 0}
              className="h-10 w-10 rounded-full border border-line text-muted transition hover:text-fg disabled:opacity-30"
              aria-label="Previous step"
            >
              ←
            </button>
            <button
              onClick={() => go(beat + 1)}
              disabled={beat === BEATS.length - 1}
              className="h-10 rounded-full bg-fg px-6 text-sm font-medium text-bg transition hover:opacity-85 disabled:opacity-30"
            >
              {beat === BEATS.length - 1 ? 'Next chapter soon' : 'Next →'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function Chip({ icon, value, bad }: { icon: ReactNode; value: string; bad?: boolean }) {
  return (
    <div
      className={`flex items-center gap-1.5 rounded-full border bg-bg/80 px-3 py-1.5 font-mono text-sm tabular-nums backdrop-blur ${
        bad ? 'border-danger text-danger' : 'border-line'
      }`}
    >
      {icon}
      {value}
    </div>
  )
}

const iconProps = { width: 14, height: 14, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5 }

function ClockIcon() {
  return (
    <svg {...iconProps} aria-label="Response time">
      <circle cx="8" cy="8" r="6.5" />
      <path d="M8 4.5V8l2.5 1.5" />
    </svg>
  )
}

function StackIcon() {
  return (
    <svg {...iconProps} aria-label="Queue">
      <rect x="1.5" y="6" width="3.5" height="3.5" />
      <rect x="6.25" y="6" width="3.5" height="3.5" />
      <rect x="11" y="6" width="3.5" height="3.5" />
    </svg>
  )
}

function CrossIcon() {
  return (
    <svg {...iconProps} aria-label="Dropped">
      <path d="M3.5 3.5l9 9M12.5 3.5l-9 9" />
    </svg>
  )
}

function ArrowIcon() {
  return (
    <svg {...iconProps} aria-label="Traffic">
      <path d="M2 8h11M9.5 4.5L13 8l-3.5 3.5" />
    </svg>
  )
}
