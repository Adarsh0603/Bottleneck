import type { Reference } from '../../core/types'

export const REFERENCE: Reference = {
  interview: [
    'A service that calls others over a network is only as reliable as its worst call. A slow dependency is more dangerous than a dead one: callers keep waiting, hold threads, connections and memory, and the failure spreads upward until the whole system is down. This is a cascading failure.',
    'Set a timeout on every remote call, and make it short. Pick it from the dependency’s real latency, such as its 99th percentile with some headroom, and never longer than the caller’s own deadline. No timeout means a thread can wait for ever. Pass a deadline down the chain, so each service knows how long is left.',
    'Retry only what is safe to repeat (idempotent calls), only for errors that may pass (timeouts, 503s, connection resets), and only a few times. Wait between tries with exponential backoff and add jitter, so a crowd of clients does not retry in step. Retries multiply load: three retries is four times the traffic on a service that is already struggling.',
    'A circuit breaker has three states. Closed: calls go through and failures are counted. Open: calls fail at once, without touching the dependency, for a cooldown. Half open: a few trial calls go through. If they work the breaker closes, if not it opens again. It sheds load from a failing service, gives it room to recover, and frees your threads.',
    'Choose what trips a breaker: consecutive failures, or a failure rate over a window of requests with a minimum count, so a handful of unlucky calls cannot trip it. Count timeouts as failures. Keep the cooldown short enough that you notice recovery, and long enough that you do not hammer a service that is still down.',
    'Plan for failure with a fallback: a cached or default answer, a feature switched off, a queued request to do later, or a clear error sent quickly. Fallbacks suit optional parts, like recommendations or reviews. For a payment, failing fast and clearly is often the right answer.',
    'A bulkhead gives each dependency its own pool of threads or connections, so one slow service cannot use up everything and starve the rest. It is named after the sealed compartments of a ship. Together with timeouts and breakers, it keeps a failure inside its own corner.',
  ],
  cards: [
    {
      title: 'Timeouts first',
      body: 'Connect timeout and read timeout are different: set both. Make the timeout of an outer call larger than the sum of the inner ones, or the outer will give up while inner calls still run. A timeout is the foundation: retries and breakers do nothing without one.',
    },
    {
      title: 'Retries done safely',
      body: 'Retry only idempotent operations, or add an idempotency key so a repeat does nothing twice. Cap the tries and the total time. Use exponential backoff with jitter. Retry at one layer only: if every layer retries three times, the bottom one sees 3 × 3 × 3 calls. Consider a retry budget, such as at most 10% extra traffic.',
    },
    {
      title: 'Tuning a breaker',
      body: 'A breaker needs a failure threshold, a minimum number of calls, a cooldown, and a number of trial calls in half open. Too sensitive and it trips on noise; too slow and the pool is gone before it opens. Expose its state in metrics and alerts: an open breaker is a symptom someone should see.',
    },
    {
      title: 'Fallbacks and degraded modes',
      body: 'Decide in advance, for each dependency, whether it is critical or optional. Optional: serve a cached copy, a default, or leave the feature out. Critical: fail fast with a clear message, or queue the work. A fallback that calls another fragile service is not a fallback.',
    },
    {
      title: 'Bulkheads in practice',
      body: 'Separate thread pools, connection pools or semaphores per dependency. Cap concurrent calls to a slow service. At a larger scale, separate whole deployments, queues and rate limits per customer or per feature, so one noisy part cannot take the rest.',
    },
    {
      title: 'In the real world',
      body: 'Resilience4j and Hystrix (Java), Polly (.NET), gobreaker (Go), opossum (Node). Envoy and Istio provide outlier detection, timeouts, retries and circuit breaking in the service mesh, without code changes. Test it for real: inject latency and failures (chaos engineering) and watch what the system does.',
    },
  ],
}
