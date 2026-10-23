import type { ReactNode } from 'react'
import type { Server } from './engine'
import Scene from './Scene'
import type { SimHandle } from './useSim'

export function Lesson({
  story,
  tryThis,
  takeaway,
  children,
}: {
  story: ReactNode
  tryThis?: ReactNode
  takeaway?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-12">
      <div className="space-y-6">
        <div className="space-y-4 text-[15px] leading-7 text-fg/85 [&_b]:font-semibold [&_b]:text-fg">{story}</div>
        {tryThis && <Callout label="Try it">{tryThis}</Callout>}
        {takeaway && (
          <Callout label="Key idea" strong>
            {takeaway}
          </Callout>
        )}
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  )
}

export function Callout({ label, strong, children }: { label: string; strong?: boolean; children: ReactNode }) {
  return (
    <div className={`rounded-xl border p-4 ${strong ? 'border-fg' : 'border-line bg-card'}`}>
      <div className="mb-1 font-mono text-[11px] uppercase tracking-widest text-muted">{label}</div>
      <div className={`text-sm leading-6 ${strong ? 'font-medium' : ''}`}>{children}</div>
    </div>
  )
}

export function SimCard({
  s,
  balancer = false,
  onServerClick,
  stats,
  controls,
}: {
  s: SimHandle
  balancer?: boolean
  onServerClick?: (server: Server) => void
  stats?: ReactNode
  controls?: ReactNode
}) {
  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-card backdrop-blur-md">
      <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
        <span className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-widest text-muted">
          <span className={`h-1.5 w-1.5 rounded-full ${s.running ? 'bg-fg' : 'bg-muted'}`} />
          Live simulation
        </span>
        <div className="flex gap-1">
          <Button onClick={() => s.setRunning((r) => !r)}>{s.running ? 'Pause' : 'Play'}</Button>
          <Button onClick={s.reset}>Reset</Button>
        </div>
      </div>
      <div className="px-2 py-3">
        <Scene sim={s.sim} rps={s.rps} balancer={balancer} onServerClick={onServerClick} />
      </div>
      {stats && <div className="border-t border-line px-4 py-4">{stats}</div>}
      {controls && <div className="space-y-5 border-t border-line px-4 py-4">{controls}</div>}
    </div>
  )
}

export function Stats({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-[repeat(auto-fit,minmax(120px,1fr))] gap-4">{children}</div>
}

export function Stat({ label, value, bad }: { label: string; value: string; bad?: boolean }) {
  return (
    <div>
      <div className="text-xs text-muted">{label}</div>
      <div className={`mt-0.5 font-mono text-xl tabular-nums ${bad ? 'text-danger' : ''}`}>{value}</div>
    </div>
  )
}

export function Slider({
  label,
  value,
  min,
  max,
  unit,
  hint,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  unit: string
  hint?: ReactNode
  onChange: (value: number) => void
}) {
  return (
    <label className="block">
      <div className="mb-2 flex items-baseline justify-between text-sm">
        <span className="font-medium">{label}</span>
        <span className="font-mono text-muted tabular-nums">
          {value} {unit}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-fg"
      />
      {hint && <div className="mt-1 text-xs text-muted">{hint}</div>}
    </label>
  )
}

export function Segmented<T extends string | number>({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: T
  options: { value: T; label: string; disabled?: boolean }[]
  onChange: (value: T) => void
}) {
  return (
    <div>
      <div className="mb-2 text-sm font-medium">{label}</div>
      <div className="inline-flex flex-wrap gap-1 rounded-xl border border-line p-1">
        {options.map((o) => (
          <button
            key={o.value}
            disabled={o.disabled}
            onClick={() => onChange(o.value)}
            className={`rounded-lg px-3 py-1.5 text-sm transition disabled:cursor-not-allowed disabled:opacity-40 ${
              value === o.value ? 'bg-fg text-bg' : 'hover:bg-subtle'
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  )
}

export function Button({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button onClick={onClick} className="rounded-md px-2.5 py-1 font-mono text-xs transition hover:bg-subtle">
      {children}
    </button>
  )
}
