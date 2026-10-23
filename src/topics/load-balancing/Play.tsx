import Player from '../../core/Player'
import type { PlayProps } from '../registry'
import { loadBalancing } from './topic'

export default function Play({ chapter, step, onChapter, onStep, onSolved }: PlayProps) {
  return (
    <Player
      topic={loadBalancing}
      index={chapter}
      startStep={step}
      onChapter={onChapter}
      onStep={onStep}
      onSolved={onSolved}
    />
  )
}
