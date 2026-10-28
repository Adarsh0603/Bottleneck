# Systemlands

Learn system design by watching systems break, then building ones that don't.

Systemlands is an interactive course in isometric 2.5D. Each topic is a small live simulation: traffic flows through servers, caches, queues and databases, and you change settings and see what happens. Short captions explain the idea. Practice challenges let you try it yourself. There are no scores or badges.

Live site: https://adarsh0603.github.io/Systemlands/

## What is inside

**19 concepts**, grouped in tracks from beginner to advanced:

- **Scaling basics:** load balancing, caching, CDN, autoscaling
- **Data:** replication, sharding, consistent hashing, CAP theorem, geospatial indexing
- **Async & reliability:** message queues, pub/sub and streams, rate limiting, circuit breakers, fan-out, real-time messaging
- **Distributed systems:** consensus, idempotency, distributed transactions (sagas), bloom filters

Each concept opens with a real-life problem, then the idea, then a way to try it. Most end with a **Build it** puzzle where you wire the pieces yourself and watch for traps.

**9 capstones** ("Design a real system"). Each one is an interview-style design with four stages: estimate the load, draw a first design, see where it breaks, then compare with a reference design.

- URL shortener, notification system, web crawler (starter)
- News feed, chat, video streaming, key-value store (intermediate)
- Payments, ride sharing (advanced)

Progress and saved builds are kept in the browser. You can sign in with Google to sync them across devices.

More topics are planned. See [ROADMAP.md](ROADMAP.md).

## Run it

Requires Node 22.

```sh
npm install
npm run dev
```

Other scripts:

| Command           | What it does                      |
| ----------------- | --------------------------------- |
| `npm run build`   | Type-check and build into `dist/` |
| `npm run preview` | Serve the production build        |
| `npm test`        | Run the test suite (Vitest)       |
| `npm run lint`    | Run ESLint                        |

## Tech

React 19, TypeScript, Vite, Tailwind CSS 4. Scenes are drawn as SVG on a shared isometric engine. Each topic's simulation is plain TypeScript with its own tests. Sign-in and sync use Firebase Auth and Firestore.

## Layout

```
src/
  core/        shared engine: isometric drawing, flow simulation, chapter player,
               build puzzles, capstone player, progress, cloud sync
  home/        realm map and topic list
  topics/      one folder per concept or capstone (simulation, chapters, scene, tests)
    registry.ts  every topic and its track
```

A topic is a simulation plus a list of chapters, registered in `src/topics/registry.ts`.

## Deploy

Pushing to `master` runs `.github/workflows/deploy.yml`, which builds the app and publishes it to GitHub Pages under `/Systemlands/`.
