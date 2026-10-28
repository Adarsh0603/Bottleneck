# Roadmap

What is built, and what is still to build. Update this as topics land.

## Built (18 concepts)
- **Scaling basics:** load balancing, caching, CDN, autoscaling
- **Data:** replication, sharding, consistent hashing, CAP, geospatial indexing (branch `geospatial`, awaiting testing)
- **Async & reliability:** message queues, pub/sub & streams, rate limiting, circuit breakers, fan-out, real-time messaging (branch `real-time`, awaiting testing)
- **Distributed:** consensus, idempotency, distributed transactions (sagas), bloom filters

## Built, awaiting testing
- **Capstone 1: URL shortener** (branch `url-shortener`)
- **Capstone 2: Notification system** (branch `notifications`), built on new engine nodes in `src/core/flow`: provider, sender with retries, dedupe store, dead letters, priority queue, pacer, ledger
- **Capstone 3: Web crawler** (branch `web-crawler`, merged)
- **Capstone 4: News feed** (branch `news-feed`), a feed sim in `src/topics/news-feed/feed.ts` with read, write and hybrid fan-out, a queue, a cache, workers and store shards
- **Capstone 7: Key-value store** (branch `key-value-store`), a leaderless store in `src/topics/key-value-store/kv.ts` with a hash ring, N/R/W quorums, stand-in writes, read repair, version counters against clock skew, and a hot-key cache

- **Capstone 8: Payments** (branch `payments`), a checkout sim in `src/topics/payments/payments.ts` with idempotency keys, a store of keys, timeouts, retries, a circuit breaker, an order queue, and crash recovery (write the order down first, or refund)
- **Capstone 9: Ride sharing** (branch `ride-sharing`), a dispatch sim in `src/topics/ride-sharing/ride.ts` with driver pings (live map vs database), map shards cut by cells or by load, claiming a car before offering it, and a request log replayed after a dispatch crash

## To build: concepts the capstones depend on
Build these before the remaining capstones.
1. **Back-of-envelope estimation** (requests per second, storage, bandwidth). Every capstone opens with it.
2. **Data modeling & choosing a database** (SQL, key-value, document, wide-column).
3. **Availability & failover** (nines, redundancy, multi-region).
4. **API design** (REST vs RPC, pagination, versioning, idempotent endpoints).
5. ~~Real-time messaging~~ (built).
6. ~~Fan-out on write vs on read~~ (built).
7. ~~Geospatial indexing~~ (built, branch `geospatial`, awaiting testing). Needed for ride sharing.

## To build: later
- Consistency models (strong, eventual, causal)
- Observability (metrics, logs, tracing)
- Blob / object storage. Also needed for video streaming.
- Search (inverted index)
- Authentication & authorization

## Project path (agreed 2026-10-25)
Projects are interview-style systems the learner builds, ordered from easy to hard. Each one lists the concepts it needs as links, and the learner can open any concept at any time (nothing is locked). They reuse `src/core/capstone/CapstonePlayer.tsx`. "New" marks a concept not built yet.

**Starter**
1. URL shortener (built): caching, replication, sharding, bloom filters, rate limiting
2. Notification system: message queues, pub/sub, rate limiting, idempotency
3. Web crawler (built): queues, bloom filters, rate limiting, consistent hashing

**Intermediate**
4. News feed (built): caching, fan-out, queues, sharding
5. Chat app (built): real-time messaging, pub/sub, replication, consistent hashing
6. Video streaming (built): CDN, queues, autoscaling, caching
7. Key-value store (built): consistent hashing, replication, CAP, consensus

**Advanced**
8. Payments / checkout (built): idempotency, sagas, circuit breakers, consensus
9. Ride sharing (built): geospatial, sharding, pub/sub, consensus

**Expert** (the large systems big companies ask about; start with Twitter timeline, WhatsApp, Uber, Google Docs)
- Twitter / X timeline: fan-out (new), caching, sharding, queues, consistent hashing
- WhatsApp at scale: real-time messaging (new), pub/sub, replication, idempotency, sharding
- Dropbox / Google Drive: chunking and dedupe (new), CDN, sharding, replication, queues
- Google Docs: collaborative editing, OT/CRDT (new), real-time messaging, consensus
- Ticketmaster / booking: locking and concurrency (new), idempotency, rate limiting, queues, sagas
- Uber at scale: geospatial (new), pub/sub, sharding, consensus, autoscaling
- Kafka / a message broker: replication, consensus, sharding, CAP
- YouTube / Netflix: CDN, autoscaling, queues, caching, adaptive streaming (new)
- Google Search: inverted index (new), sharding, caching, bloom filters
- Stripe / payments platform: idempotency, sagas, circuit breakers, consensus, ledger design (new)

**AI (the Machine Isles, a fifth island, agreed 2026-10-25).** New concepts to build first: embeddings and vector search, chunking and retrieval, LLM serving (batching, streaming, KV cache), agent loop and tool calling, guardrails, evals, semantic and prompt caching, cost and latency budgets.
- Document Q&A (RAG chatbot): embeddings, chunking, vector search, caching
- Semantic search: embeddings, vector search, sharding, caching
- LLM gateway: rate limiting, semantic caching, circuit breakers, queues, cost budgets
- Support agent: agent loop and tools, idempotency, guardrails, evals
- Coding assistant: chunking and retrieval, agent loop, sandboxing, streaming
- ChatGPT-style serving: LLM serving, autoscaling, queues, sharding, streaming
- Multi-agent workflow: agent loop, sagas, queues, evals, observability

About 26 systems. Each needs its own simulation and stages, at roughly the cost of the URL shortener. Open questions: whether the project path replaces or sits beside the city map on the home screen, and whether it starts before the second project is built.

## Left out for now
Clocks and ordering, gossip, HyperLogLog and count-min sketch, encryption and TLS, deployment strategies.

## Postponed
"Build it" chapters for consensus, idempotency, distributed transactions, bloom filters, real-time messaging and geospatial indexing. The Blob storage chapter (video streaming uses a fixed store node for now).
