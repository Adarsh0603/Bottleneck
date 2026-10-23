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

export function solvedCount(progress: Progress, topic: TopicEntry) {
  const solved = topicProgress(progress, topic.id).solved
  return (topic.challenges ?? []).filter((id) => solved.includes(id)).length
}

// Pick up where the learner left off; a finished topic starts over for review.
export function openTopic(progress: Progress, topic: TopicEntry, chapter?: number) {
  if (chapter !== undefined) return navigate({ page: 'topic', topic: topic.id, chapter, step: 0 })
  const last = statusOf(progress, topic) === 'done' ? undefined : topicProgress(progress, topic.id).last
  navigate({ page: 'topic', topic: topic.id, chapter: last?.chapter ?? 0, step: last?.step ?? 0 })
}

export const topicNumber = (topic: TopicEntry) => String(TOPICS.indexOf(topic) + 1).padStart(2, '0')

export const trackOf = (topic: TopicEntry) => TRACKS.find((t) => t.id === topic.track)!

export const actionLabel = (status: TopicStatus) =>
  status === 'done' ? 'Review' : status === 'started' ? 'Continue' : 'Start'
