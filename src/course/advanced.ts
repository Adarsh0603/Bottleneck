export const ADVANCED = [
  {
    title: 'Layer 4 vs Layer 7',
    body: 'L4 routes by IP and port: fast, works for any protocol. L7 reads the HTTP request, so it can route /api and /images differently, end TLS, and retry.',
  },
  {
    title: 'Sticky sessions',
    body: 'Pinning a user to one server keeps in-memory sessions working, but breaks balance and failover. Prefer stateless servers and a shared session store like Redis.',
  },
  {
    title: 'Health checks in depth',
    body: 'Active checks poll an endpoint, passive checks watch real errors. Use thresholds (3 fails in a row) and connection draining so removed servers finish their work.',
  },
  {
    title: 'Consistent hashing',
    body: 'When the same key must reach the same server (e.g. caches), hash it onto a ring. Adding or removing a server only moves a small slice of keys.',
  },
  {
    title: 'Global load balancing',
    body: 'GeoDNS or anycast sends users to the nearest healthy region; regular load balancers take over inside it.',
  },
  {
    title: 'Real-world tools',
    body: 'Nginx, HAProxy, Envoy, Traefik. AWS ALB (L7) and NLB (L4), GCP and Azure load balancers. Kubernetes Services and Ingress.',
  },
]

export const INTERVIEW = [
  'Put a load balancer in front of any stateless tier with more than one server.',
  'Name your algorithm and why: round robin for uniform work, least connections or power of two for uneven work.',
  'Cover the load balancer’s own redundancy before you’re asked.',
  'Keep app servers stateless so scaling out stays trivial.',
  'Mention health checks, retries and N+1 capacity when discussing failures.',
]
