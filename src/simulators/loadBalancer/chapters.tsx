import { useEffect, useState } from 'react'
import type { Algorithm, Server } from './engine'
import { Callout, Lesson, Segmented, SimCard, Slider, Stat, Stats } from './ui'
import { capacity, useSim } from './useSim'

const ms = (value: number) => `${Math.round(value)} ms`
const pct = (value: number) => `${value.toFixed(0)}%`

/* 1 ─ Beginner ─────────────────────────────────────────────────────────── */

export function OneServer() {
  const s = useSim((sim) => sim.addServer(1), 1)

  return (
    <Lesson
      story={
        <>
          <p>
            When someone opens your app, their phone or browser sends a <b>request</b> over the internet to a computer you
            run, called a <b>server</b>. The server does some work, like reading from a database, and sends back a{' '}
            <b>response</b>.
          </p>
          <p>
            A server can only do a few things at the same time. This one has <b>4 workers</b>, shown as the four small boxes.
            Each request uses one worker for about a second. If all four are busy, new requests wait in a <b>queue</b>.
          </p>
        </>
      }
      tryThis="Watch a dot (a request) travel to the server, fill a worker box, and disappear when it's done. Then move the slider up a little."
      takeaway="A server is a machine with a limited number of workers. Each request either gets a worker, waits in line, or is turned away."
    >
      <SimCard
        s={s}
        stats={
          <Stats>
            <Stat label="Response time" value={ms(s.avgMs)} />
            <Stat label="Requests served" value={String(s.sim.stats.completed)} />
          </Stats>
        }
        controls={<Slider label="Traffic" value={s.rps} min={1} max={3} unit="req/s" onChange={s.setRps} />}
      />
    </Lesson>
  )
}

/* 2 ─ Beginner ─────────────────────────────────────────────────────────── */

const LAUNCH_PEAK = 12

export function TrafficGrows() {
  const s = useSim((sim) => sim.addServer(1), 2)
  const [launching, setLaunching] = useState(false)
  const { rps, setRps } = s

  // "Launch day": traffic climbs by 1 req/s every second until the peak.
  useEffect(() => {
    if (!launching) return
    if (rps >= LAUNCH_PEAK) {
      setLaunching(false)
      return
    }
    const id = setTimeout(() => setRps(rps + 1), 1000)
    return () => clearTimeout(id)
  }, [launching, rps, setRps])

  const server = s.sim.servers[0]
  const cap = capacity(s.sim)

  return (
    <Lesson
      story={
        <>
          <p>
            Your app gets popular. More users means more <b>requests per second</b> (req/s), the number engineers use to
            describe load.
          </p>
          <p>
            With 4 workers and about a second per request, this server can finish roughly <b>{cap.toFixed(1)} req/s</b>.
            That number is its <b>capacity</b>. Below it, everything is fine. Above it, requests arrive faster than they
            finish, so the queue grows and every user waits longer. That wait is <b>latency</b>.
          </p>
          <p>
            Once the queue is full, the server has to <b>turn requests away</b>. Your users see errors and timeouts.
          </p>
        </>
      }
      tryThis="Press “Simulate launch day” and watch what happens as traffic passes capacity: latency climbs first, then requests start getting dropped."
      takeaway="Every server has a capacity. Push past it and latency rises first, then errors begin. One server will eventually not be enough."
    >
      <SimCard
        s={s}
        stats={
          <Stats>
            <Stat label="Response time" value={ms(s.avgMs)} bad={s.avgMs > 2500} />
            <Stat label="Waiting in queue" value={String(server?.queue.length ?? 0)} />
            <Stat label="Turned away" value={pct(s.dropRate)} bad={s.dropRate > 1} />
          </Stats>
        }
        controls={
          <>
            <Slider
              label="Traffic"
              value={rps}
              min={1}
              max={LAUNCH_PEAK}
              unit="req/s"
              hint={`Capacity ≈ ${cap.toFixed(1)} req/s`}
              onChange={(v) => {
                setLaunching(false)
                setRps(v)
              }}
            />
            <button
              onClick={() => {
                setRps(1)
                setLaunching(true)
              }}
              disabled={launching}
              className="rounded-lg bg-fg px-4 py-2 text-sm font-medium text-bg transition hover:opacity-85 disabled:opacity-40"
            >
              {launching ? 'Traffic rising…' : 'Simulate launch day'}
            </button>
          </>
        }
      />
    </Lesson>
  )
}

/* 3 ─ Beginner ─────────────────────────────────────────────────────────── */

const SIZES = [
  { value: 1, label: 'Small · $50/mo' },
  { value: 2, label: 'Large · $120/mo' },
  { value: 4, label: 'XL · $300/mo' },
  { value: 8, label: '8× · not sold', disabled: true },
]

export function ScaleUp() {
  const [size, setSize] = useState(1)
  const s = useSim((sim) => sim.addServer(size), 6)
  const server = s.sim.servers[0]

  const pickSize = (value: number) => {
    setSize(value)
    if (server) server.speed = value
    s.rerender()
  }

  return (
    <Lesson
      story={
        <>
          <p>
            The obvious fix is to buy a <b>bigger machine</b> with faster CPUs and more memory. This is called{' '}
            <b>vertical scaling</b>, or <b>scaling up</b>. It needs no code changes, which is why teams usually do it first.
          </p>
          <p>But it runs into three walls:</p>
          <ul className="list-disc space-y-1 pl-5">
            <li>
              <b>A ceiling:</b> there is always a biggest machine you can buy.
            </li>
            <li>
              <b>Cost:</b> top-end hardware costs more per unit of power.
            </li>
            <li>
              <b>A single point of failure:</b> it's still one machine. If it goes down, your whole app goes down.
            </li>
          </ul>
        </>
      }
      tryThis="At 6 req/s the small server struggles. Upgrade it until the queue clears. Push traffic to 20, past what even the biggest server can handle. Then click the server to crash it."
      takeaway="Scaling up is simple and a good first step, but it has a hard limit, gets expensive, and leaves everything riding on one machine."
    >
      <SimCard
        s={s}
        onServerClick={(sv) => {
          s.sim.setAlive(sv.id, !sv.alive)
          s.rerender()
        }}
        stats={
          <Stats>
            <Stat label="Response time" value={ms(s.avgMs)} bad={s.avgMs > 2500} />
            <Stat label="Turned away" value={pct(s.dropRate)} bad={s.dropRate > 1} />
            <Stat label="Capacity" value={`${capacity(s.sim).toFixed(1)}/s`} />
          </Stats>
        }
        controls={
          <>
            <Segmented label="Machine size" value={size} options={SIZES} onChange={pickSize} />
            <Slider label="Traffic" value={s.rps} min={1} max={30} unit="req/s" onChange={s.setRps} />
          </>
        }
      />
    </Lesson>
  )
}

/* 4 ─ Intermediate ─────────────────────────────────────────────────────── */

export function ScaleOut() {
  const [balanced, setBalanced] = useState(false)
  const s = useSim((sim) => {
    sim.algorithm = balanced ? 'round-robin' : 'direct'
    sim.addServer(1)
    sim.addServer(1)
    sim.addServer(1)
  }, 7)

  const toggle = (on: boolean) => {
    setBalanced(on)
    s.sim.algorithm = on ? 'round-robin' : 'direct'
    s.rerender()
  }

  const busy = s.sim.servers.filter((sv) => sv.active.length + sv.queue.length > 0).length

  return (
    <Lesson
      story={
        <>
          <p>
            Instead of one huge machine, run <b>several ordinary ones</b>. This is <b>horizontal scaling</b>, or{' '}
            <b>scaling out</b>. Need more capacity? Add another server. If one dies, the others keep going.
          </p>
          <p>
            But there's a catch. Users reach your app through a single address: a domain name that points to one IP. Adding
            servers B and C does nothing if every request still goes to A.
          </p>
          <p>
            A <b>load balancer</b> fixes this. It takes over the public address, receives every request, and forwards each
            one to a server behind it. Users never see that there are many servers. The simplest strategy is{' '}
            <b>round robin</b>: A, then B, then C, then A again.
          </p>
        </>
      }
      tryThis="With the load balancer off, Server A drowns while B and C sit idle. Turn it on and watch the load spread out."
      takeaway="A load balancer turns many servers into one service. Once it's in place, adding capacity is as easy as adding servers."
    >
      <SimCard
        s={s}
        balancer={balanced}
        stats={
          <Stats>
            <Stat label="Servers in use" value={`${busy} / ${s.sim.servers.length}`} />
            <Stat label="Response time" value={ms(s.avgMs)} bad={s.avgMs > 2500} />
            <Stat label="Turned away" value={pct(s.dropRate)} bad={s.dropRate > 1} />
          </Stats>
        }
        controls={
          <>
            <Segmented
              label="Load balancer"
              value={balanced ? 'on' : 'off'}
              options={[
                { value: 'off', label: 'Off' },
                { value: 'on', label: 'On' },
              ]}
              onChange={(v) => toggle(v === 'on')}
            />
            <Slider label="Traffic" value={s.rps} min={1} max={15} unit="req/s" onChange={s.setRps} />
          </>
        }
      />
    </Lesson>
  )
}

/* 5 ─ Intermediate ─────────────────────────────────────────────────────── */

const ALGORITHMS: { value: Algorithm; label: string; explain: string }[] = [
  {
    value: 'round-robin',
    label: 'Round robin',
    explain: 'Takes turns: A, B, C, D, A… It’s simple and fair, but blind. The slow server gets the same share as the fast ones.',
  },
  {
    value: 'random',
    label: 'Random',
    explain: 'Picks any server at random. It needs no coordination, but unlucky streaks pile requests onto one server.',
  },
  {
    value: 'least-connections',
    label: 'Least connections',
    explain: 'Sends each request to the server with the fewest requests in progress. Slow servers stay busy longer, so they naturally get fewer requests.',
  },
]

export function ChoosingServer() {
  const [algorithm, setAlgorithm] = useState<Algorithm>('round-robin')
  const s = useSim((sim) => {
    sim.algorithm = algorithm
    sim.addServer(1)
    sim.addServer(1)
    sim.addServer(1)
    sim.addServer(0.5)
  }, 9)

  const pick = (a: Algorithm) => {
    setAlgorithm(a)
    s.sim.algorithm = a
    s.rerender()
  }

  return (
    <Lesson
      story={
        <>
          <p>
            For every request, the load balancer must choose <b>which server</b> gets it. The rule it uses is called the{' '}
            <b>load balancing algorithm</b>.
          </p>
          <p>
            Real servers are rarely identical. One might be older hardware, another might be stuck on a heavy request. Here,{' '}
            <b>Server D runs at half speed</b>. A good algorithm notices that and sends it less work.
          </p>
          <p>{ALGORITHMS.find((a) => a.value === algorithm)!.explain}</p>
        </>
      }
      tryThis="Under round robin, Server D turns red and starts turning users away, even though the fleet as a whole has room. Switch to least connections."
      takeaway="Round robin works when servers and requests are alike. When they differ, choose servers by how busy they actually are."
    >
      <SimCard
        s={s}
        balancer
        stats={
          <Stats>
            <Stat label="Turned away" value={pct(s.dropRate)} bad={s.dropRate > 1} />
            <Stat label="Response time" value={ms(s.avgMs)} />
            <Stat label="Slowest 5%" value={ms(s.p95Ms)} bad={s.p95Ms > 4000} />
          </Stats>
        }
        controls={
          <>
            <Segmented label="Algorithm" value={algorithm} options={ALGORITHMS} onChange={pick} />
            <Slider label="Traffic" value={s.rps} min={1} max={15} unit="req/s" onChange={s.setRps} />
          </>
        }
      />
    </Lesson>
  )
}

/* 6 ─ Intermediate ─────────────────────────────────────────────────────── */

export function Failures() {
  const s = useSim((sim) => {
    sim.algorithm = 'least-connections'
    for (let i = 0; i < 4; i++) sim.addServer(1)
  }, 8)

  const toggle = (server: Server) => {
    s.sim.setAlive(server.id, !server.alive)
    s.rerender()
  }

  const healthy = s.sim.servers.filter((sv) => sv.alive).length

  return (
    <Lesson
      story={
        <>
          <p>
            Servers fail. Disks die, a bad deploy crashes the process, memory runs out. With many servers, something is
            always broken somewhere.
          </p>
          <p>
            Load balancers handle this with <b>health checks</b>. Every few seconds they call each server, for example{' '}
            <code className="font-mono text-[13px]">GET /health</code>. A server that stops answering is taken out of
            rotation, and once it recovers it's added back. Users never get sent to a dead machine.
          </p>
          <p>
            Two things still hurt. Requests that were already on the crashed server are <b>lost</b>, so clients need to
            retry. And the remaining servers must <b>absorb the extra load</b>. That's why teams keep spare capacity,
            often called <b>N+1</b>: enough to survive losing a server.
          </p>
        </>
      }
      tryThis="Click a server to crash it. Expect a short blip, then the others cover for it. Crash a second one and the rest can no longer keep up. Click again to restart them."
      takeaway="Health checks route around failures automatically, but you only survive a failure if the remaining servers have room to spare."
    >
      <SimCard
        s={s}
        balancer
        onServerClick={toggle}
        stats={
          <Stats>
            <Stat label="Healthy servers" value={`${healthy} / ${s.sim.servers.length}`} bad={healthy < s.sim.servers.length} />
            <Stat label="Turned away" value={pct(s.dropRate)} bad={s.dropRate > 1} />
            <Stat label="Capacity" value={`${capacity(s.sim).toFixed(1)}/s`} bad={capacity(s.sim) < s.rps} />
          </Stats>
        }
        controls={
          <Slider
            label="Traffic"
            value={s.rps}
            min={1}
            max={15}
            unit="req/s"
            hint="Click any server in the diagram to crash or restart it."
            onChange={s.setRps}
          />
        }
      />
    </Lesson>
  )
}

/* 7 ─ Advanced ─────────────────────────────────────────────────────────── */

const ADVANCED = [
  {
    title: 'Layer 4 vs Layer 7',
    body: 'An L4 balancer routes by IP and port without reading the request. It’s very fast and works for any protocol. An L7 balancer reads the HTTP request, so it can route /api to one pool and /images to another, terminate TLS, and retry failed requests. It costs more CPU per request.',
  },
  {
    title: 'Who balances the balancer?',
    body: 'A single load balancer is itself a single point of failure. Run a pair in active-passive mode with a floating IP that moves on failure, or several active ones behind DNS. Managed options such as AWS ALB/NLB or GCP Load Balancing do this for you.',
  },
  {
    title: 'Sticky sessions',
    body: 'Pinning each user to one server (by cookie or IP hash) lets you keep session data in memory. The cost: uneven load, and users lose their session when that server dies. Better: make servers stateless and keep sessions in a shared store such as Redis.',
  },
  {
    title: 'Power of two choices',
    body: 'Least connections needs an up-to-date view of every server, which is hard when many load balancers run in parallel. Instead, pick two servers at random and send the request to the less busy one. This gets most of the benefit at almost no cost.',
  },
  {
    title: 'Consistent hashing',
    body: 'Sometimes the same key should always reach the same server, for example a user’s cache entries. Consistent hashing does this, and when a server is added or removed only a small slice of keys moves.',
  },
  {
    title: 'Global load balancing',
    body: 'With data centers on several continents, GeoDNS or anycast sends each user to the nearest healthy region. Inside each region, regular load balancers take over. Failover can then happen between regions, not just between servers.',
  },
  {
    title: 'Health checks in depth',
    body: 'Active checks poll an endpoint. Passive checks watch real traffic for errors. Use thresholds (for example, 3 failures in a row) to avoid flapping. Use connection draining so a server being removed can finish its in-flight requests first.',
  },
  {
    title: 'Real-world tools',
    body: 'Software: Nginx, HAProxy, Envoy, Traefik. Cloud: AWS ALB (L7) and NLB (L4), GCP Cloud Load Balancing, Azure Load Balancer. In Kubernetes, Services and Ingress controllers fill this role.',
  },
]

const INTERVIEW = [
  'Put a load balancer in front of any stateless tier as soon as you have more than one server.',
  'Say which algorithm you’d use and why: round robin for uniform work, least connections or power-of-two for uneven work.',
  'Address the load balancer’s own redundancy before the interviewer asks.',
  'Keep app servers stateless so any server can handle any request and scaling out stays trivial.',
  'Mention health checks, retries, and N+1 capacity when you discuss failures.',
]

export function Advanced() {
  return (
    <div className="space-y-10">
      <p className="max-w-2xl text-[15px] leading-7 text-fg/85">
        You now know why load balancers exist and how they work. These are the details that come up in production and in
        senior-level system design interviews.
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        {ADVANCED.map((a) => (
          <div key={a.title} className="rounded-2xl border border-line bg-card p-5 backdrop-blur-md">
            <h3 className="font-medium">{a.title}</h3>
            <p className="mt-2 text-sm leading-6 text-muted">{a.body}</p>
          </div>
        ))}
      </div>
      <Callout label="In an interview" strong>
        <ul className="list-disc space-y-1.5 pl-5 font-normal">
          {INTERVIEW.map((i) => (
            <li key={i}>{i}</li>
          ))}
        </ul>
      </Callout>
    </div>
  )
}
