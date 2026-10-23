import Player from '../../core/Player'
import type { PlayProps } from '../registry'
import { loadBalancing } from './topic'

export default function Play({ chapter, onChapter }: PlayProps) {
  return <Player key={chapter} topic={loadBalancing} index={chapter} onChapter={onChapter} />
}
