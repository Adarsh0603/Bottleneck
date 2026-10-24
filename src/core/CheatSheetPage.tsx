import type { TopicEntry } from '../topics/registry'
import { CHEAT_SHEET, TopBar } from './chrome'
import ReferenceSheet from './ReferenceSheet'

// The interview cheat sheet as its own stop in a topic's chapter menu,
// after the last chapter.
export default function CheatSheetPage({
  topic,
  doneChapters,
  onChapter,
}: {
  topic: TopicEntry
  doneChapters: number[]
  onChapter: (index: number) => void
}) {
  const chapters = [...(topic.chapters ?? []).map((title) => ({ title, level: 'Advanced' as const })), { title: CHEAT_SHEET, level: 'Advanced' as const }]
  return (
    <div className="relative h-[calc(100svh-57px)] min-h-[260px] w-full overflow-hidden">
      <ReferenceSheet reference={topic.reference!} title={CHEAT_SHEET} sub={`The ${topic.title} details that come up most.`} />
      <div className="pointer-events-none absolute inset-x-0 top-0 z-20 p-3 sm:p-4">
        <TopBar chapters={chapters} index={chapters.length - 1} doneChapters={doneChapters} onChapter={onChapter} />
      </div>
    </div>
  )
}
