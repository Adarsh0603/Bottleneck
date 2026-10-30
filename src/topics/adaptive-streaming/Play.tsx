import Player from '../../core/Player'
import type { PlayProps } from '../registry'
import { adaptiveStreaming } from './topic'

export default function Play({ chapter, step, ...rest }: PlayProps) {
  return <Player topic={adaptiveStreaming} index={chapter} startStep={step} {...rest} />
}
