import type { Chapter, Shot } from './types'

const DEFAULT_SHOT: Shot = { target: [0, 0.5, 0], zoom: 1 }

// The state at a beat is the chapter's starting state plus every beat's
// changes up to and including it, so jumping to any beat is consistent.
export function stateAt<S, B extends { set?: Partial<S> }>(chapter: Chapter<S, B>, index: number): S {
  return chapter.beats.slice(0, index + 1).reduce<S>((st, b) => ({ ...st, ...b.set }), chapter.initial)
}

// The state just before a beat plays: what's on screen while a prediction
// question for that beat is being asked.
export function stateBefore<S, B extends { set?: Partial<S> }>(chapter: Chapter<S, B>, index: number): S {
  return index > 0 ? stateAt(chapter, index - 1) : chapter.initial
}

// A beat without its own shot keeps the camera where the last one put it.
export function shotAt<S, B extends { shot?: Shot }>(chapter: Chapter<S, B>, index: number, fallback = DEFAULT_SHOT): Shot {
  for (let i = index; i >= 0; i--) {
    const shot = chapter.beats[i].shot
    if (shot) return shot
  }
  return fallback
}
