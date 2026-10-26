import Player from '../../core/Player'
import type { PlayProps } from '../registry'
import { fanOut } from './topic'

export default function Play({ chapter, step, ...rest }: PlayProps) {
  return <Player topic={fanOut} index={chapter} startStep={step} {...rest} />
}
