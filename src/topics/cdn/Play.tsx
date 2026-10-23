import Player from '../../core/Player'
import type { PlayProps } from '../registry'
import { cdn } from './topic'

export default function Play({ chapter, step, ...rest }: PlayProps) {
  return <Player topic={cdn} index={chapter} startStep={step} {...rest} />
}
