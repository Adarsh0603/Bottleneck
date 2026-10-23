import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { Algorithm, LoadBalancerSim } from '../simulators/loadBalancer/engine'
import { capacity, useSim } from '../simulators/loadBalancer/useSim'
import { ADVANCED, INTERVIEW } from './advanced'
import { CHAPTERS, monthlyCost, shotAt, SIZES, stateAt } from './chapters'
import { Segmented, Slider, Stepper } from './controls'
import IsoScene from './iso/IsoScene'
import { isSoundOn, play, setSoundOn } from './sound'
import { syncSim } from './sync'
import type { CourseState, HudId, SceneProps } from './types'

const MAX_SERVERS = 6

export default function Player() {
  const [chapter, setChapter] = useState(0)
  return <ChapterPlayer key={chapter} index={chapter} onChapter={setChapter} />
}

function ChapterPlayer({ index, onChapter }: { index: number; onChapter: (index: number) => void }) {
  const chapter = CHAPTERS[index]
  const [beatIdx, setBeatIdx] = useState(0)
  const [st, setSt] = useState(() => stateAt(chapter, 0))
  const [ramping, setRamping] = useState(!!chapter.beats[0].ramp)
  const [shake, setShake] = useState(0)
  const [solvedBeat, setSolvedBeat] = useState(-1)
  const [sound, setSound] = useState(isSoundOn)
  const [menuOpen, setMenuOpen] = useState(false)

  const stRef = useRef(st)
  stRef.current = st
  const s = useSim((sim) => syncSim(sim, stRef.current), st.rps)
  const { sim, setRps } = s

  const beat = chapter.beats[beatIdx]
  const challenge = beat.challenge
  const solved = solvedBeat === beatIdx
  const lastBeat = beatIdx === chapter.beats.length - 1
  const lastChapter = index === CHAPTERS.length - 1

  const holdStart = useRef<number | null>(null)

  const go = (i: number) => {
    if (i >= chapter.beats.length) return onChapter(Math.min(index + 1, CHAPTERS.length - 1))
    if (i < 0) return onChapter(Math.max(index - 1, 0))
    setBeatIdx(i)
    setSt(stateAt(chapter, i))
    setRamping(!!chapter.beats[i].ramp)
    holdStart.current = null
  }

  useEffect(() => {
    syncSim(sim, st)
    setRps(st.rps)
  }, [sim, st, setRps])

  // Shake and sound when something breaks; a rising tone when something arrives.
  const prev = useRef(st)
  useEffect(() => {
    const p = prev.current
    prev.current = st
    if (st.down.length > p.down.length || (st.failover && !p.failover)) {
      setShake((k) => k + 1)
      play('crash')
    }
    if (st.servers.length > p.servers.length || (st.balancer && !p.balancer) || (st.standby && !p.standby)) play('rise')
  }, [st])

  // "Traffic climbs": +1 req/s on a timer until the beat's peak.
  useEffect(() => {
    if (!ramping || !beat.ramp) return
    if (st.rps >= beat.ramp.to) {
      setRamping(false)
      return
    }
    const id = setTimeout(() => setSt((p) => ({ ...p, rps: Math.floor(p.rps) + 1 })), beat.ramp.everyMs)
    return () => clearTimeout(id)
  }, [ramping, beat.ramp, st.rps])


  // Runs after every tick: drop sounds, and checking the challenge goal is
  // held long enough.
  const lastDrops = useRef(0)
  const lastDropSound = useRef(0)
  const { dropRate, avgMs, p95Ms, throughput } = s
  const tick = sim.tick
  useEffect(() => {
    const now = performance.now()
    if (sim.stats.dropped > lastDrops.current && now - lastDropSound.current > 220) {
      play('drop')
      lastDropSound.current = now
    }
    lastDrops.current = sim.stats.dropped

    if (!challenge || solved || tick === 0) return
    if (challenge.check({ m: { dropRate, avgMs, p95Ms, throughput }, st, sim })) {
      holdStart.current ??= now
      if (now - holdStart.current >= challenge.holdSeconds * 1000) {
        setSolvedBeat(beatIdx)
        play('success')
      }
    } else {
      holdStart.current = null
    }
  }, [sim, tick, challenge, solved, st, beatIdx, dropRate, avgMs, p95Ms, throughput])

  const holdProgress =
    challenge && holdStart.current !== null
      ? Math.min(1, (performance.now() - holdStart.current) / (challenge.holdSeconds * 1000))
      : 0

  const update = (change: (p: CourseState) => Partial<CourseState>) => setSt((p) => ({ ...p, ...change(p) }))
  const toggleServer = (i: number) =>
    update((p) => ({ down: p.down.includes(i) ? p.down.filter((d) => d !== i) : [...p.down, i] }))

  const sceneProps: SceneProps = {
    simRef: s.simRef,
    lastTickAt: s.lastTickAt,
    st,
    beat,
    shot: shotAt(chapter, beatIdx),
    shake,
    onServerClick: toggleServer,
  }

  return (
    <div className="relative h-[calc(100svh-57px)] min-h-[600px] w-full overflow-hidden">
      <div className="absolute inset-0">
        <IsoScene {...sceneProps} />
      </div>

      {/* Top: chapter menu, sound and live numbers. */}
      <div className="pointer-events-none absolute inset-x-0 top-0 space-y-3 p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="pointer-events-auto relative flex items-center gap-2">
            <button
              onClick={() => setMenuOpen((o) => !o)}
              className="flex items-center gap-2 rounded-full border border-line bg-bg/80 px-3 py-1.5 text-sm backdrop-blur transition hover:border-fg"
            >
              <span className="font-mono text-xs text-muted">{String(index + 1).padStart(2, '0')}</span>
              <span className="font-medium">{chapter.title}</span>
              <span className="text-muted">▾</span>
            </button>
            <span className="hidden rounded-full border border-line bg-bg/80 px-2 py-0.5 font-mono text-[10px] uppercase tracking-widest text-muted backdrop-blur sm:inline">
              {chapter.level}
            </span>
            {menuOpen && (
              <ol className="absolute left-0 top-full z-20 mt-2 w-60 overflow-hidden rounded-xl border border-line bg-bg shadow-lg">
                {CHAPTERS.map((c, i) => (
                  <li key={c.title}>
                    <button
                      onClick={() => {
                        setMenuOpen(false)
                        onChapter(i)
                      }}
                      className={`flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm transition hover:bg-subtle ${
                        i === index ? 'font-medium' : 'text-muted'
                      }`}
                    >
                      <span className="font-mono text-xs">{String(i + 1).padStart(2, '0')}</span>
                      {c.title}
                    </button>
                  </li>
                ))}
              </ol>
            )}
          </div>
          <button
            onClick={() => {
              setSoundOn(!sound)
              setSound(!sound)
            }}
            className="pointer-events-auto rounded-full border border-line bg-bg/80 px-3 py-1.5 font-mono text-xs text-muted backdrop-blur transition hover:text-fg"
          >
            Sound {sound ? 'on' : 'off'}
          </button>
        </div>

        <div className="flex flex-wrap gap-2">
          {(beat.hud ?? []).map((id) => (
            <HudChip key={id} id={id} st={st} sim={sim} m={{ dropRate, avgMs }} />
          ))}
        </div>
      </div>

      {beat.sheet && <InterviewSheet />}

      {/* Bottom: challenge, caption, controls and navigation. */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-linear-to-t from-bg via-bg/90 to-transparent px-4 pb-6 pt-16">
        <div className="mx-auto flex max-w-5xl flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
          <div key={`${index}-${beatIdx}`} className="caption-in pointer-events-auto min-w-0">
            {challenge && (
              <div
                className={`mb-4 max-w-md rounded-xl border p-3 transition ${
                  solved ? 'border-fg bg-fg text-bg' : 'border-line bg-bg/80 backdrop-blur'
                }`}
              >
                <div className="font-mono text-[10px] uppercase tracking-widest opacity-70">
                  {solved ? '✓ Solved' : 'Challenge'}
                </div>
                <div className="mt-1 text-sm font-medium">{solved ? challenge.win : challenge.goal}</div>
                {!solved && (
                  <div className="mt-2 h-1 overflow-hidden rounded-full bg-line">
                    <div className="h-full rounded-full bg-fg transition-[width]" style={{ width: `${holdProgress * 100}%` }} />
                  </div>
                )}
              </div>
            )}
            <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">{beat.caption}</h2>
            {beat.sub && <p className="mt-1 text-muted">{beat.sub}</p>}

            {beat.controls && (
              <div className="mt-4 flex flex-wrap items-end gap-3">
                {beat.controls.includes('traffic') && (
                  <Slider
                    label="Traffic"
                    value={st.rps}
                    min={1}
                    max={15}
                    unit="req/s"
                    hint={`This server handles ≈ ${capacity(sim).toFixed(1)} req/s`}
                    onChange={(v) => {
                      setRamping(false)
                      update(() => ({ rps: v }))
                    }}
                  />
                )}
                {beat.controls.includes('size') && (
                  <Segmented
                    value={st.servers[0]}
                    options={[
                      ...SIZES.map((sz) => ({ value: sz.value, label: `${sz.label} · $${sz.cost}` })),
                      { value: 8, label: '8× · not sold', disabled: true },
                    ]}
                    onChange={(v) => update(() => ({ servers: [v] }))}
                  />
                )}
                {beat.controls.includes('servers') && (
                  <Stepper
                    value={st.servers.length}
                    min={1}
                    max={MAX_SERVERS}
                    label="server"
                    onChange={(n) =>
                      update((p) => ({
                        servers: n > p.servers.length ? [...p.servers, 1] : p.servers.slice(0, n),
                        down: p.down.filter((d) => d < n),
                      }))
                    }
                  />
                )}
                {beat.controls.includes('balancer') && (
                  <Segmented
                    value={st.balancer ? 'on' : 'off'}
                    options={[
                      { value: 'off', label: 'No load balancer' },
                      { value: 'on', label: 'Load balancer' },
                    ]}
                    onChange={(v) => update(() => ({ balancer: v === 'on' }))}
                  />
                )}
                {beat.controls.includes('algorithm') && (
                  <Segmented<Algorithm>
                    value={st.algorithm}
                    options={[
                      { value: 'round-robin', label: 'Round robin' },
                      { value: 'random', label: 'Random' },
                      { value: 'least-connections', label: 'Least connections' },
                    ]}
                    onChange={(v) => update(() => ({ algorithm: v }))}
                  />
                )}
              </div>
            )}
          </div>

          <div className="pointer-events-auto flex shrink-0 items-center gap-2">
            <button
              onClick={() => go(beatIdx - 1)}
              disabled={beatIdx === 0 && index === 0}
              className="h-10 w-10 rounded-full border border-line bg-bg/80 text-muted backdrop-blur transition hover:text-fg disabled:opacity-30"
              aria-label="Previous step"
            >
              ←
            </button>
            <button
              onClick={() => go(beatIdx + 1)}
              disabled={lastBeat && lastChapter}
              className={`h-10 rounded-full px-6 text-sm font-medium transition disabled:opacity-30 ${
                challenge && !solved
                  ? 'border border-line bg-bg/80 text-muted backdrop-blur hover:text-fg'
                  : 'bg-fg text-bg hover:opacity-85'
              } ${solved ? 'animate-pulse' : ''}`}
            >
              {lastBeat && lastChapter
                ? 'The end'
                : challenge && !solved
                  ? 'Skip →'
                  : lastBeat
                    ? `Next: ${CHAPTERS[index + 1].title} →`
                    : 'Next →'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function HudChip({
  id,
  st,
  sim,
  m,
}: {
  id: HudId
  st: CourseState
  sim: LoadBalancerSim
  m: { dropRate: number; avgMs: number }
}) {
  const limit = sim.config.queueLimit
  switch (id) {
    case 'traffic':
      return <Chip icon={<ArrowIcon />} title="Traffic" value={`${st.rps} req/s`} />
    case 'latency':
      return <Chip icon={<ClockIcon />} title="Response time" value={`${(m.avgMs / 1000).toFixed(1)}s`} bad={m.avgMs > 2500} />
    case 'queue': {
      const longest = Math.max(0, ...sim.servers.map((s) => s.queue.length))
      return <Chip icon={<StackIcon />} title="Queue" value={`${longest} / ${limit}`} bad={longest >= limit * 0.75} />
    }
    case 'dropped':
      return <Chip icon={<CrossIcon />} title="Errors" value={`${m.dropRate.toFixed(0)}%`} bad={m.dropRate > 1} />
    case 'capacity': {
      const cap = capacity(sim)
      return <Chip icon={<GaugeIcon />} title="Capacity" value={`${cap.toFixed(1)} req/s`} bad={cap < st.rps} />
    }
    case 'cost':
      return <Chip icon={<CoinIcon />} title="Cost" value={`$${monthlyCost(st)}/mo`} />
    case 'healthy': {
      const alive = sim.servers.filter((s) => s.alive).length
      return <Chip icon={<HeartIcon />} title="Healthy servers" value={`${alive} / ${sim.servers.length}`} bad={alive < sim.servers.length} />
    }
  }
}

function Chip({ icon, title, value, bad }: { icon: ReactNode; title: string; value: string; bad?: boolean }) {
  return (
    <div
      aria-label={`${title}: ${value}`}
      className={`min-w-28 rounded-xl border bg-bg/80 px-3 py-2 backdrop-blur transition-colors ${
        bad ? 'border-danger' : 'border-line'
      }`}
    >
      <div className={`flex items-center gap-1.5 text-[11px] font-medium ${bad ? 'text-danger' : 'text-muted'}`}>
        {icon}
        {title}
      </div>
      <div className={`mt-0.5 font-mono text-base tabular-nums ${bad ? 'text-danger' : ''}`}>{value}</div>
    </div>
  )
}

function InterviewSheet() {
  return (
    <div className="caption-in absolute right-4 top-32 bottom-56 z-10 w-[min(26rem,calc(100%-2rem))] space-y-3 overflow-y-auto rounded-2xl border border-line bg-bg/90 p-4 backdrop-blur-md">
      <div className="rounded-xl border border-fg p-4">
        <div className="mb-2 font-mono text-[10px] uppercase tracking-widest text-muted">In an interview</div>
        <ul className="list-disc space-y-1.5 pl-5 text-sm">
          {INTERVIEW.map((i) => (
            <li key={i}>{i}</li>
          ))}
        </ul>
      </div>
      {ADVANCED.map((a) => (
        <div key={a.title} className="rounded-xl border border-line p-4">
          <h3 className="text-sm font-medium">{a.title}</h3>
          <p className="mt-1 text-sm leading-6 text-muted">{a.body}</p>
        </div>
      ))}
    </div>
  )
}

const iconProps = { width: 14, height: 14, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5 }

function ArrowIcon() {
  return (
    <svg {...iconProps}>
      <path d="M2 8h11M9.5 4.5L13 8l-3.5 3.5" />
    </svg>
  )
}

function ClockIcon() {
  return (
    <svg {...iconProps}>
      <circle cx="8" cy="8" r="6.5" />
      <path d="M8 4.5V8l2.5 1.5" />
    </svg>
  )
}

function StackIcon() {
  return (
    <svg {...iconProps}>
      <rect x="1.5" y="6" width="3.5" height="3.5" />
      <rect x="6.25" y="6" width="3.5" height="3.5" />
      <rect x="11" y="6" width="3.5" height="3.5" />
    </svg>
  )
}

function CrossIcon() {
  return (
    <svg {...iconProps}>
      <path d="M3.5 3.5l9 9M12.5 3.5l-9 9" />
    </svg>
  )
}

function GaugeIcon() {
  return (
    <svg {...iconProps}>
      <path d="M2 11a6 6 0 0 1 12 0" />
      <path d="M8 11l3-3.5" />
    </svg>
  )
}

function CoinIcon() {
  return (
    <svg {...iconProps}>
      <circle cx="8" cy="8" r="6.5" />
      <path d="M10 5.5H7a1.25 1.25 0 0 0 0 2.5h2a1.25 1.25 0 0 1 0 2.5H6M8 4v8" />
    </svg>
  )
}

function HeartIcon() {
  return (
    <svg {...iconProps}>
      <path d="M8 13.5S2 10 2 6a3 3 0 0 1 6-1 3 3 0 0 1 6 1c0 4-6 7.5-6 7.5z" />
    </svg>
  )
}
