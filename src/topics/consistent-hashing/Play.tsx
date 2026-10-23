import Player from '../../core/Player'
import type { PlayProps } from '../registry'
import { consistentHashing } from './topic'

export default function Play({ chapter, step, ...rest }: PlayProps) {
  return <Player topic={consistentHashing} index={chapter} startStep={step} {...rest} />
}
