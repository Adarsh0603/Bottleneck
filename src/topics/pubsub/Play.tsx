import Player from '../../core/Player'
import type { PlayProps } from '../registry'
import { pubsub } from './topic'

export default function Play({ chapter, step, ...rest }: PlayProps) {
  return <Player topic={pubsub} index={chapter} startStep={step} {...rest} />
}
