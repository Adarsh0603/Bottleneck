import CapstonePlayer from '../../core/capstone/CapstonePlayer'
import type { PlayProps } from '../registry'
import { RIDE_SHARING } from './build'

export default function Play({ chapter, doneChapters, onChapter, onCheatSheet, onStep, onSolved, onFinish }: PlayProps) {
  return (
    <CapstonePlayer
      capstone={RIDE_SHARING}
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
