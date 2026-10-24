import Player from '../../core/Player'
import type { PlayProps } from '../registry'
import { cap } from './topic'

export default function Play({ chapter, step, ...rest }: PlayProps) {
  return <Player topic={cap} index={chapter} startStep={step} {...rest} />
}
