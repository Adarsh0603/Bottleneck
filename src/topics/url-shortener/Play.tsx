import CapstonePlayer from '../../core/capstone/CapstonePlayer'
import type { PlayProps } from '../registry'
import { URL_SHORTENER } from './build'

export default function Play({ chapter, doneChapters, onChapter, onCheatSheet, onStep, onSolved, onFinish }: PlayProps) {
  return (
    <CapstonePlayer
      capstone={URL_SHORTENER}
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
