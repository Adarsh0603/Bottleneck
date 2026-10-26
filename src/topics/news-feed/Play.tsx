import CapstonePlayer from '../../core/capstone/CapstonePlayer'
import type { PlayProps } from '../registry'
import { NEWS_FEED } from './build'

export default function Play({ chapter, doneChapters, onChapter, onCheatSheet, onStep, onSolved, onFinish }: PlayProps) {
  return (
    <CapstonePlayer
      capstone={NEWS_FEED}
      chapter={chapter}
      doneChapters={doneChapters}
      onChapter={onChapter}
      onCheatSheet={onCheatSheet}
      onStep={onStep}
      onSolved={onSolved}
      onFinish={onFinish}
    />
  )
}
