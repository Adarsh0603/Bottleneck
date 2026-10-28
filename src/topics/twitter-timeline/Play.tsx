import CapstonePlayer from '../../core/capstone/CapstonePlayer'
import type { PlayProps } from '../registry'
import { TWITTER_TIMELINE } from './build'

export default function Play({ chapter, doneChapters, onChapter, onCheatSheet, onStep, onSolved, onFinish }: PlayProps) {
  return (
    <CapstonePlayer
      capstone={TWITTER_TIMELINE}
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
