import type { LoadBalancerSim, Server } from './engine'

const W = 760
const H = 380
const USERS = { x: 80, y: H / 2 }
const LB = { x: 300, y: H / 2 }
const SERVER_X = 520
const SERVER_W = 210

const ALGORITHM_LABEL: Record<string, string> = {
  'round-robin': 'round robin',
  random: 'random',
  'least-connections': 'least connections',
}

function serverY(index: number, count: number) {
  const slot = H / count
  return slot * index + slot / 2
}

export default function Scene({
  sim,
  rps,
  balancer,
  onServerClick,
}: {
  sim: LoadBalancerSim
  rps: number
  balancer: boolean
  onServerClick?: (server: Server) => void
}) {
  const servers = sim.servers
  const boxH = Math.min(84, H / servers.length - 14)
  const hub = balancer ? LB : USERS
  const reachable = (i: number) => balancer || i === 0

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full select-none" role="img" aria-label="Request flow simulation">
      {balancer && <line x1={USERS.x} y1={USERS.y} x2={LB.x} y2={LB.y} className="stroke-line" strokeWidth={1.5} />}
      {servers.map((s, i) => (
        <line
          key={s.id}
          x1={hub.x}
          y1={hub.y}
          x2={SERVER_X}
          y2={serverY(i, servers.length)}
          className={reachable(i) && s.alive ? 'stroke-line' : 'stroke-line opacity-50'}
          strokeWidth={1.5}
          strokeDasharray={reachable(i) && s.alive ? undefined : '4 6'}
        />
      ))}

      {sim.inTransit.map((t) => {
        const idx = servers.findIndex((s) => s.id === t.serverId)
        if (idx < 0) return null
        const target = { x: SERVER_X, y: serverY(idx, servers.length) }
        const [from, to, k] = !balancer
          ? [USERS, target, t.progress]
          : t.progress < 0.5
            ? [USERS, LB, t.progress * 2]
            : [LB, target, (t.progress - 0.5) * 2]
        return (
          <circle key={t.job.id} cx={from.x + (to.x - from.x) * k} cy={from.y + (to.y - from.y) * k} r={4.5} className="fill-fg" />
        )
      })}

      <g>
        <rect x={USERS.x - 44} y={USERS.y - 30} width={88} height={60} rx={30} className="fill-bg stroke-fg" strokeWidth={1.5} />
        <text x={USERS.x} y={USERS.y + 5} textAnchor="middle" className="fill-fg text-[14px] font-medium">
          Users
        </text>
        <text x={USERS.x} y={USERS.y + 52} textAnchor="middle" className="fill-muted font-mono text-[12px]">
          {rps} req/s
        </text>
      </g>

      {balancer && (
        <g>
          <rect x={LB.x - 62} y={LB.y - 34} width={124} height={68} rx={12} className="fill-fg" />
          <text x={LB.x} y={LB.y - 3} textAnchor="middle" className="fill-bg text-[13px] font-medium">
            Load balancer
          </text>
          <text x={LB.x} y={LB.y + 16} textAnchor="middle" className="fill-bg font-mono text-[11px] opacity-70">
            {ALGORITHM_LABEL[sim.algorithm]}
          </text>
        </g>
      )}

      {servers.map((s, i) => (
        <ServerBox
          key={s.id}
          server={s}
          y={serverY(i, servers.length) - boxH / 2}
          height={boxH}
          queueLimit={sim.config.queueLimit}
          onClick={onServerClick && (() => onServerClick(s))}
        />
      ))}
    </svg>
  )
}

function ServerBox({
  server,
  y,
  height,
  queueLimit,
  onClick,
}: {
  server: Server
  y: number
  height: number
  queueLimit: number
  onClick?: () => void
}) {
  const overloaded = server.alive && server.queue.length >= queueLimit * 0.75
  const pad = 14
  const barW = SERVER_W - pad * 2
  const slotGap = 5
  const slotW = (barW - (server.slots - 1) * slotGap) / server.slots
  const showQueue = height >= 72

  return (
    <g onClick={onClick} className={onClick ? 'cursor-pointer' : undefined}>
      {onClick && <title>{server.alive ? `Click to crash ${server.name}` : `Click to restart ${server.name}`}</title>}
      <rect
        x={SERVER_X}
        y={y}
        width={SERVER_W}
        height={height}
        rx={10}
        className={`fill-bg ${!server.alive ? 'stroke-muted' : overloaded ? 'stroke-danger' : 'stroke-fg'}`}
        strokeWidth={overloaded ? 2 : 1.5}
        strokeDasharray={server.alive ? undefined : '5 5'}
      />
      <text x={SERVER_X + pad} y={y + 22} className={`text-[13px] font-medium ${server.alive ? 'fill-fg' : 'fill-muted'}`}>
        {server.name}
      </text>
      <text
        x={SERVER_X + SERVER_W - pad}
        y={y + 22}
        textAnchor="end"
        className={`font-mono text-[11px] ${server.alive ? 'fill-muted' : 'fill-danger'}`}
      >
        {!server.alive ? 'DOWN' : server.speed !== 1 ? `${server.speed}× speed` : ''}
      </text>

      {server.alive && (
        <>
          {Array.from({ length: server.slots }, (_, k) => (
            <rect
              key={k}
              x={SERVER_X + pad + k * (slotW + slotGap)}
              y={y + 32}
              width={slotW}
              height={10}
              rx={2}
              className={k < server.active.length ? 'fill-fg' : 'fill-subtle stroke-line'}
            />
          ))}
          {showQueue && (
            <>
              <rect x={SERVER_X + pad} y={y + 54} width={barW} height={5} rx={2.5} className="fill-subtle" />
              <rect
                x={SERVER_X + pad}
                y={y + 54}
                width={(barW * server.queue.length) / queueLimit}
                height={5}
                rx={2.5}
                className={overloaded ? 'fill-danger' : 'fill-fg'}
              />
              <text x={SERVER_X + pad} y={y + 74} className="fill-muted font-mono text-[10px]">
                waiting {server.queue.length}/{queueLimit}
              </text>
            </>
          )}
        </>
      )}
    </g>
  )
}
