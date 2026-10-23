import Player from '../../core/Player'
import type { PlayProps } from '../registry'
import { caching } from './topic'

export default function Play({ chapter, step, ...rest }: PlayProps) {
  return <Player topic={caching} index={chapter} startStep={step} {...rest} />
}
