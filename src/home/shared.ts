import { currentProgress, topicProgress, type Progress } from '../core/progress'
import { navigate } from '../core/router'
import { TOPICS, TRACKS, type TopicEntry } from '../topics/registry'
import { isBuilt, PROJECTS } from './projects'

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

// A lesson always opens at its first chapter, even when continuing; finished
// chapters are ticked in the chapter menu, so the learner can jump ahead.
// A capstone opens on the stage the learner was last in.
export function openTopic(topic: TopicEntry, chapter?: number) {
  const last = topic.track === 'capstones' ? topicProgress(currentProgress(), topic.id).last?.chapter : undefined
  const at = chapter ?? (last !== undefined && last < (topic.chapters?.length ?? 0) ? last : 0)
  navigate({ page: 'topic', topic: topic.id, chapter: at, step: 0 })
}

export const topicNumber = (topic: TopicEntry) => String(TOPICS.indexOf(topic) + 1).padStart(2, '0')

export const trackOf = (topic: TopicEntry) => TRACKS.find((t) => t.id === topic.track)!

export const actionLabel = (status: TopicStatus) =>
  status === 'done' ? 'Review' : status === 'started' ? 'Continue' : 'Start'

// On the realm map a project is built, the next one to take on, or still under mist.
export type ProjectState = 'done' | 'next' | 'fog'

export function projectStates(progress: Progress): Record<string, ProjectState> {
  const done = (id: string) => {
    const topic = TOPICS.find((t) => t.id === id)
    return !!topic && isBuilt(PROJECTS.find((p) => p.id === id)!) && statusOf(progress, topic) === 'done'
  }
  const next = PROJECTS.find((p) => !done(p.id))
  return Object.fromEntries(PROJECTS.map((p) => [p.id, done(p.id) ? 'done' : p === next ? 'next' : 'fog'])) as Record<string, ProjectState>
}
