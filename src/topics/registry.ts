import type { ComponentType } from 'react'
import type { Level, Reference } from '../core/types'
import { CHAPTERS as AUTOSCALING_CHAPTERS } from './autoscaling/chapters'
import AutoscalingPlay from './autoscaling/Play'
import { REFERENCE as AUTOSCALING_REFERENCE } from './autoscaling/reference'
import { CHAPTERS as CACHING_CHAPTERS } from './caching/chapters'
import CachingPlay from './caching/Play'
import { REFERENCE as CACHING_REFERENCE } from './caching/reference'
import { CHAPTERS as CAP_CHAPTERS } from './cap/chapters'
import CapPlay from './cap/Play'
import { REFERENCE as CAP_REFERENCE } from './cap/reference'
import { CHAPTERS as CIRCUIT_BREAKERS_CHAPTERS } from './circuit-breakers/chapters'
import CircuitBreakersPlay from './circuit-breakers/Play'
import { REFERENCE as CIRCUIT_BREAKERS_REFERENCE } from './circuit-breakers/reference'
import { CHAPTERS as CDN_CHAPTERS } from './cdn/chapters'
import CdnPlay from './cdn/Play'
import { REFERENCE as CDN_REFERENCE } from './cdn/reference'
import { CHAPTERS as CONSENSUS_CHAPTERS } from './consensus/chapters'
import ConsensusPlay from './consensus/Play'
import { CHAPTERS as CONSISTENT_HASHING_CHAPTERS } from './consistent-hashing/chapters'
import ConsistentHashingPlay from './consistent-hashing/Play'
import { REFERENCE as CONSISTENT_HASHING_REFERENCE } from './consistent-hashing/reference'
import { CHAPTERS as LOAD_BALANCING_CHAPTERS } from './load-balancing/chapters'
import LoadBalancingPlay from './load-balancing/Play'
import { CHAPTERS as PUBSUB_CHAPTERS } from './pubsub/chapters'
import PubsubPlay from './pubsub/Play'
import { REFERENCE as PUBSUB_REFERENCE } from './pubsub/reference'
import { ADVANCED as LOAD_BALANCING_CARDS, INTERVIEW as LOAD_BALANCING_INTERVIEW } from './load-balancing/reference'
import { CHAPTERS as RATE_LIMITING_CHAPTERS } from './rate-limiting/chapters'
import RateLimitingPlay from './rate-limiting/Play'
import { REFERENCE as RATE_LIMITING_REFERENCE } from './rate-limiting/reference'
import { CHAPTERS as QUEUES_CHAPTERS } from './queues/chapters'
import QueuesPlay from './queues/Play'
import { REFERENCE as QUEUES_REFERENCE } from './queues/reference'
import { CHAPTERS as REPLICATION_CHAPTERS } from './replication/chapters'
import ReplicationPlay from './replication/Play'
import { REFERENCE as REPLICATION_REFERENCE } from './replication/reference'
import { CHAPTERS as SHARDING_CHAPTERS } from './sharding/chapters'
import ShardingPlay from './sharding/Play'
import { REFERENCE as SHARDING_REFERENCE } from './sharding/reference'

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
  doneChapters: number[]
  onChapter: (index: number) => void
  onStep: (step: number, isLastStep: boolean) => void
  onSolved: (step: number) => void
  onFinish: () => void
  // Opens the interview cheat sheet, when the topic has one.
  onCheatSheet?: () => void
}

export interface TopicEntry {
  id: string
  title: string
  short?: string // a shorter name for tight spots, like the map
  track: TrackId
  pitch: string
  chapters?: string[]
  challenges?: string[] // "chapter:step" of every practice challenge
  Play?: ComponentType<PlayProps>
  // Interview notes, opened from the chapter menu after the last chapter.
  reference?: Reference
}

// Every practice challenge, including a "Build it" chapter's goal.
const challengeIds = (chapters: { build?: unknown; beats: { challenge?: unknown }[] }[]) =>
  chapters.flatMap((c, ci) => (c.build ? [`${ci}:0`] : c.beats.flatMap((b, bi) => (b.challenge ? [`${ci}:${bi}`] : []))))

export const TOPICS: TopicEntry[] = [
  {
    id: 'load-balancing',
    title: 'Load balancing',
    track: 'scaling',
    pitch: 'Spread traffic across servers, and survive when they fail.',
    chapters: LOAD_BALANCING_CHAPTERS.map((c) => c.title),
    challenges: challengeIds(LOAD_BALANCING_CHAPTERS),
    Play: LoadBalancingPlay,
    reference: { interview: LOAD_BALANCING_INTERVIEW, cards: LOAD_BALANCING_CARDS },
  },
  {
    id: 'caching',
    title: 'Caching',
    track: 'scaling',
    pitch: 'Stop the database drowning by remembering answers.',
    chapters: CACHING_CHAPTERS.map((c) => c.title),
    challenges: challengeIds(CACHING_CHAPTERS),
    Play: CachingPlay,
    reference: CACHING_REFERENCE,
  },
  {
    id: 'cdn',
    title: 'CDN',
    track: 'scaling',
    pitch: 'Serve users from a box near them, not across the world.',
    chapters: CDN_CHAPTERS.map((c) => c.title),
    challenges: challengeIds(CDN_CHAPTERS),
    Play: CdnPlay,
    reference: CDN_REFERENCE,
  },
  {
    id: 'autoscaling',
    title: 'Autoscaling',
    track: 'scaling',
    pitch: 'Add and remove servers as traffic rises and falls.',
    chapters: AUTOSCALING_CHAPTERS.map((c) => c.title),
    challenges: challengeIds(AUTOSCALING_CHAPTERS),
    Play: AutoscalingPlay,
    reference: AUTOSCALING_REFERENCE,
  },

  {
    id: 'replication',
    title: 'Database replication',
    short: 'Replication',
    track: 'data',
    pitch: 'Copy data to replicas for reads, and live with lag.',
    chapters: REPLICATION_CHAPTERS.map((c) => c.title),
    challenges: challengeIds(REPLICATION_CHAPTERS),
    Play: ReplicationPlay,
    reference: REPLICATION_REFERENCE,
  },
  {
    id: 'sharding',
    title: 'Sharding',
    track: 'data',
    pitch: 'Split one database into many by key.',
    chapters: SHARDING_CHAPTERS.map((c) => c.title),
    challenges: challengeIds(SHARDING_CHAPTERS),
    Play: ShardingPlay,
    reference: SHARDING_REFERENCE,
  },
  {
    id: 'consistent-hashing',
    title: 'Consistent hashing',
    track: 'data',
    pitch: 'Add a node without reshuffling every key.',
    chapters: CONSISTENT_HASHING_CHAPTERS.map((c) => c.title),
    challenges: challengeIds(CONSISTENT_HASHING_CHAPTERS),
    Play: ConsistentHashingPlay,
    reference: CONSISTENT_HASHING_REFERENCE,
  },
  {
    id: 'cap',
    title: 'CAP & consistency',
    track: 'data',
    pitch: 'When the network splits, choose: correct or available.',
    chapters: CAP_CHAPTERS.map((c) => c.title),
    challenges: challengeIds(CAP_CHAPTERS),
    Play: CapPlay,
    reference: CAP_REFERENCE,
  },

  {
    id: 'queues',
    title: 'Message queues',
    track: 'async',
    pitch: 'Absorb bursts and do slow work in the background.',
    chapters: QUEUES_CHAPTERS.map((c) => c.title),
    challenges: challengeIds(QUEUES_CHAPTERS),
    Play: QueuesPlay,
    reference: QUEUES_REFERENCE,
  },
  {
    id: 'pubsub',
    title: 'Pub/sub & streams',
    short: 'Pub/sub',
    track: 'async',
    pitch: 'One event, many listeners, in order.',
    chapters: PUBSUB_CHAPTERS.map((c) => c.title),
    challenges: challengeIds(PUBSUB_CHAPTERS),
    Play: PubsubPlay,
    reference: PUBSUB_REFERENCE,
  },
  {
    id: 'rate-limiting',
    title: 'Rate limiting',
    track: 'async',
    pitch: 'Protect everyone from one noisy client.',
    chapters: RATE_LIMITING_CHAPTERS.map((c) => c.title),
    challenges: challengeIds(RATE_LIMITING_CHAPTERS),
    Play: RateLimitingPlay,
    reference: RATE_LIMITING_REFERENCE,
  },
  {
    id: 'circuit-breakers',
    title: 'Timeouts, retries & circuit breakers',
    short: 'Circuit breakers',
    track: 'async',
    pitch: 'Stop one slow dependency taking the site down.',
    chapters: CIRCUIT_BREAKERS_CHAPTERS.map((c) => c.title),
    challenges: challengeIds(CIRCUIT_BREAKERS_CHAPTERS),
    Play: CircuitBreakersPlay,
    reference: CIRCUIT_BREAKERS_REFERENCE,
  },

  {
    id: 'consensus',
    title: 'Leader election & consensus',
    short: 'Consensus',
    track: 'distributed',
    pitch: 'Agree on one leader, even when nodes die.',
    chapters: CONSENSUS_CHAPTERS.map((c) => c.title),
    challenges: challengeIds(CONSENSUS_CHAPTERS),
    Play: ConsensusPlay,
  },
  { id: 'idempotency', title: 'Idempotency & exactly-once', short: 'Idempotency', track: 'distributed', pitch: 'Retry safely without charging twice.' },
  { id: 'sagas', title: 'Distributed transactions', track: 'distributed', pitch: 'Finish or cleanly undo work across services.' },
  { id: 'bloom-filters', title: 'Bloom filters', track: 'distributed', pitch: 'Answer “have I seen this?” in a few bits.' },

  { id: 'url-shortener', title: 'URL shortener', track: 'capstones', pitch: 'Billions of redirects, mostly reads.' },
  { id: 'news-feed', title: 'News feed', track: 'capstones', pitch: 'Fan out posts to millions of followers.' },
  { id: 'chat', title: 'Chat app', track: 'capstones', pitch: 'Real-time messages and who’s online.' },
  { id: 'video-streaming', title: 'Video streaming', track: 'capstones', pitch: 'Upload, transcode, and stream worldwide.' },
  { id: 'ride-sharing', title: 'Ride sharing', track: 'capstones', pitch: 'Match riders and drivers by location, live.' },
]
