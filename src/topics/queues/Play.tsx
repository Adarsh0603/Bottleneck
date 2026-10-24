import Player from '../../core/Player'
import type { PlayProps } from '../registry'
import { queues } from './topic'

export default function Play({ chapter, step, ...rest }: PlayProps) {
  return <Player topic={queues} index={chapter} startStep={step} {...rest} />
}
