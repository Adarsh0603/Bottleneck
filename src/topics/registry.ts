import type { ComponentType } from 'react'
import type { Level } from '../core/types'
import { CHAPTERS as CACHING_CHAPTERS } from './caching/chapters'
import CachingPlay from './caching/Play'
import { CHAPTERS as LOAD_BALANCING_CHAPTERS } from './load-balancing/chapters'
import LoadBalancingPlay from './load-balancing/Play'

// Every concept Bottleneck teaches, in the recommended order. A topic with no
// `Play` yet isn't built and shows as "Soon".

export type TrackId = 'scaling' | 'data' | 'async' | 'distributed' | 'capstones'

export const TRACKS: { id: TrackId; title: string; level: Level }[] = [
  { id: 'scaling', title: 'Scaling basics', level: 'Beginner' },
  { id: 'data', title: 'Data', level: 'Intermediate' },
  { id: 'async', title: 'Async & reliability', level: 'Intermediate' },
  { id: 'distributed', title: 'Distributed systems', level: 'Advanced' },
  { id: 'capstones', title: 'Design a real system', level: 'Advanced' },
]

export interface PlayProps {
  chapter: number
  step: number
  onChapter: (index: number) => void
  onStep: (step: number, isLastStep: boolean) => void
  onSolved: (step: number) => void
}

export interface TopicEntry {
  id: string
  title: string
  track: TrackId
  pitch: string
  chapters?: string[]
  Play?: ComponentType<PlayProps>
}

export const TOPICS: TopicEntry[] = [
  {
    id: 'load-balancing',
    title: 'Load balancing',
    track: 'scaling',
    pitch: 'Spread traffic across servers, and survive when they fail.',
    chapters: LOAD_BALANCING_CHAPTERS.map((c) => c.title),
    Play: LoadBalancingPlay,
  },
  {
    id: 'caching',
    title: 'Caching',
    track: 'scaling',
    pitch: 'Stop the database drowning by remembering answers.',
    chapters: CACHING_CHAPTERS.map((c) => c.title),
    Play: CachingPlay,
  },
  { id: 'cdn', title: 'CDN', track: 'scaling', pitch: 'Serve users from a box near them, not across the world.' },
  { id: 'autoscaling', title: 'Autoscaling', track: 'scaling', pitch: 'Add and remove servers as traffic rises and falls.' },

  { id: 'replication', title: 'Database replication', track: 'data', pitch: 'Copy data to replicas for reads, and live with lag.' },
  { id: 'sharding', title: 'Sharding', track: 'data', pitch: 'Split one database into many by key.' },
  { id: 'consistent-hashing', title: 'Consistent hashing', track: 'data', pitch: 'Add a node without reshuffling every key.' },
  { id: 'cap', title: 'CAP & consistency', track: 'data', pitch: 'When the network splits, choose: correct or available.' },

  { id: 'queues', title: 'Message queues', track: 'async', pitch: 'Absorb bursts and do slow work in the background.' },
  { id: 'pubsub', title: 'Pub/sub & streams', track: 'async', pitch: 'One event, many listeners, in order.' },
  { id: 'rate-limiting', title: 'Rate limiting', track: 'async', pitch: 'Protect everyone from one noisy client.' },
  { id: 'circuit-breakers', title: 'Timeouts, retries & circuit breakers', track: 'async', pitch: 'Stop one slow dependency taking the site down.' },

  { id: 'consensus', title: 'Leader election & consensus', track: 'distributed', pitch: 'Agree on one leader, even when nodes die.' },
  { id: 'idempotency', title: 'Idempotency & exactly-once', track: 'distributed', pitch: 'Retry safely without charging twice.' },
  { id: 'sagas', title: 'Distributed transactions', track: 'distributed', pitch: 'Finish or cleanly undo work across services.' },
  { id: 'bloom-filters', title: 'Bloom filters', track: 'distributed', pitch: 'Answer “have I seen this?” in a few bits.' },

  { id: 'url-shortener', title: 'URL shortener', track: 'capstones', pitch: 'Billions of redirects, mostly reads.' },
  { id: 'news-feed', title: 'News feed', track: 'capstones', pitch: 'Fan out posts to millions of followers.' },
  { id: 'chat', title: 'Chat app', track: 'capstones', pitch: 'Real-time messages and who’s online.' },
  { id: 'video-streaming', title: 'Video streaming', track: 'capstones', pitch: 'Upload, transcode, and stream worldwide.' },
  { id: 'ride-sharing', title: 'Ride sharing', track: 'capstones', pitch: 'Match riders and drivers by location, live.' },
]
