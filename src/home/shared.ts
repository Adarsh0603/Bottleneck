import { topicProgress, type Progress } from '../core/progress'
import { navigate } from '../core/router'
import { TOPICS, TRACKS, type TopicEntry } from '../topics/registry'

// Helpers both home views (map and list) share.

export const builtTopics = TOPICS.filter((t) => t.Play && t.chapters)
export const chapterCounts = Object.fromEntries(builtTopics.map((t) => [t.id, t.chapters!.length]))

export type TopicStatus = 'soon' | 'new' | 'started' | 'done'

export function statusOf(progress: Progress, topic: TopicEntry): TopicStatus {
  if (!topic.Play || !topic.chapters) return 'soon'
  const p = topicProgress(progress, topic.id)
  if (p.done.length >= topic.chapters.length) return 'done'
  return p.done.length > 0 || p.last ? 'started' : 'new'
}

// The first built topic, in recommended order, that isn't finished yet.
export function nextTopic(progress: Progress) {
  return builtTopics.find((t) => statusOf(progress, t) !== 'done')
}

// What to suggest after finishing `topic`: the next unfinished topic after it
// in the recommended order, else any unfinished one.
export function nextAfter(progress: Progress, topic: TopicEntry) {
  const later = builtTopics.slice(builtTopics.indexOf(topic) + 1)
  return later.find((t) => statusOf(progress, t) !== 'done') ?? builtTopics.find((t) => t !== topic && statusOf(progress, t) !== 'done')
}

// A topic always opens at its first chapter, even when continuing; finished
// chapters are ticked in the chapter menu, so the learner can jump ahead.
export function openTopic(topic: TopicEntry, chapter = 0) {
  navigate({ page: 'topic', topic: topic.id, chapter, step: 0 })
}

export const topicNumber = (topic: TopicEntry) => String(TOPICS.indexOf(topic) + 1).padStart(2, '0')

export const trackOf = (topic: TopicEntry) => TRACKS.find((t) => t.id === topic.track)!

export const actionLabel = (status: TopicStatus) =>
  status === 'done' ? 'Review' : status === 'started' ? 'Continue' : 'Start'
