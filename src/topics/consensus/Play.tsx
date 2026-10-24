import Player from '../../core/Player'
import type { PlayProps } from '../registry'
import { consensus } from './topic'

export default function Play({ chapter, step, ...rest }: PlayProps) {
  return <Player topic={consensus} index={chapter} startStep={step} {...rest} />
}
