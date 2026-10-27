import Player from '../../core/Player'
import type { PlayProps } from '../registry'
import { realTime } from './topic'

export default function Play({ chapter, step, ...rest }: PlayProps) {
  return <Player topic={realTime} index={chapter} startStep={step} {...rest} />
}
