import type { Reference } from '../../core/types'

export const REFERENCE: Reference = {
  interview: [
    'A rate limiter protects a service from too much traffic, whether from a bug, a greedy client or an attack. It answers requests over the limit with HTTP 429 and, ideally, a Retry-After header, so honest clients know when to come back.',
    'Decide what to count by: the user, the API key, the IP address, or the endpoint. Count everyone together and one noisy client uses up the allowance for all. IP addresses are a weak key, since an office or a mobile network can share one.',
    'Fixed window counts per clock interval. It is cheap, but a client can send the limit just before the window ends and the limit again just after it starts, getting twice the limit through in a moment. A sliding window (log or counter) counts the last interval and closes that gap.',
    'A token bucket refills at a steady rate up to a maximum, and each request takes a token. It allows a burst up to the bucket size and holds the average to the refill rate. It is the usual choice for APIs, and what many gateways use.',
    'A leaky bucket queues requests and releases them at a fixed rate, so the service behind sees a steady stream. It smooths bursts rather than allowing them, at the price of waiting. Use it to protect something that cannot take spikes.',
    'With several gateways, each counting alone, the real limit is the limit times the number of gateways. Keep the counters in a shared store such as Redis, and update them atomically. That costs a network hop per request and makes the store a dependency: decide whether to fail open or fail closed if it is down.',
  ],
  cards: [
    {
      title: 'Choosing an algorithm',
      body: 'Fixed window: simplest and cheapest, with the boundary burst. Sliding window: exact and fair, a bit more memory. Token bucket: lets honest bursts through and caps the average. Leaky bucket: a steady output for a fragile backend, with some waiting.',
    },
    {
      title: 'What to key on',
      body: 'Authenticated traffic: the user or API key. Anonymous traffic: the IP, with care for shared addresses. Also limit by cost: an expensive endpoint can have a lower limit than a cheap one. Layer limits: a per-user limit and a global limit that protects the whole service.',
    },
    {
      title: 'Where to put it',
      body: 'At the edge or API gateway, so abusive traffic never reaches your servers. Add a second limit inside the service for its own protection. A client-side limit helps honest clients, but never counts as protection.',
    },
    {
      title: 'Telling the client',
      body: 'Return 429 Too Many Requests with Retry-After, and headers that show the limit and what is left. Clients should back off with jitter, not retry at once, or they turn a limit into a retry storm.',
    },
    {
      title: 'Failing open or closed',
      body: 'If the limiter or its store fails, letting everything through keeps users happy but exposes the service. Turning everything away is safe for the service but is an outage. Most public APIs fail open for a short time, and keep a local limit as a fallback.',
    },
    {
      title: 'Real-world setups',
      body: 'Nginx limit_req (leaky bucket), Envoy and Kong rate limit plugins, AWS API Gateway and WAF (token bucket), Cloudflare rate limiting at the edge. Redis with a Lua script is the usual shared counter.',
    },
  ],
}
