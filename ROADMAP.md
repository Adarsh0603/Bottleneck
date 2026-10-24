# Roadmap

What is built, and what is still to build. Update this as topics land.

## Built (16 concepts)
- **Scaling basics:** load balancing, caching, CDN, autoscaling
- **Data:** replication, sharding, consistent hashing, CAP
- **Async & reliability:** message queues, pub/sub & streams, rate limiting, circuit breakers
- **Distributed:** consensus, idempotency, distributed transactions (sagas), bloom filters

## Built, awaiting testing
- **Capstone 1: URL shortener** (branch `url-shortener`)

## To build: concepts the capstones depend on
Build these before the remaining capstones.
1. **Back-of-envelope estimation** (requests per second, storage, bandwidth). Every capstone opens with it.
2. **Data modeling & choosing a database** (SQL, key-value, document, wide-column).
3. **Availability & failover** (nines, redundancy, multi-region).
4. **API design** (REST vs RPC, pagination, versioning, idempotent endpoints).
5. **Real-time messaging** (WebSockets, long polling, server-sent events). Needed for chat.
6. **Fan-out on write vs on read.** Needed for news feed.
7. **Geospatial indexing.** Needed for ride sharing.

## To build: later
- Consistency models (strong, eventual, causal)
- Observability (metrics, logs, tracing)
- Blob / object storage. Also needed for video streaming.
- Search (inverted index)
- Authentication & authorization

## To build: remaining capstones
News feed, chat app, video streaming, ride sharing. They reuse `src/core/capstone/CapstonePlayer.tsx`.

## Left out for now
Clocks and ordering, gossip, HyperLogLog and count-min sketch, encryption and TLS, deployment strategies.

## Postponed
"Build it" chapters for consensus, idempotency, distributed transactions and bloom filters.
