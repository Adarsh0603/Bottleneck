// Tiny synthesized sound effects. Off by default; the choice is remembered.

export type Sound =
  | 'crash'
  | 'success'
  | 'built' // a build that runs clean
  | 'conquered' // a capstone's final build
  | 'drop'
  | 'rise'
  | 'right' // a question answered right
  | 'wrong'
  | 'pickup' // building: a piece picked up
  | 'place'
  | 'remove'

let ctx: AudioContext | null = null
let enabled = readSaved()

function readSaved() {
  try {
    return localStorage.getItem('sound') === 'on'
  } catch {
    return false
  }
}

export function isSoundOn() {
  return enabled
}

export function setSoundOn(on: boolean) {
  enabled = on
  try {
    localStorage.setItem('sound', on ? 'on' : 'off')
  } catch {
    // Not remembered, but still works for this visit.
  }
}

export function play(sound: Sound) {
  if (!enabled) return
  try {
    ctx ??= new AudioContext()
  } catch {
    return
  }
  const audio = ctx
  const t = audio.currentTime

  const tone = (freq: number, start: number, dur: number, type: OscillatorType, gain: number, endFreq?: number) => {
    const osc = audio.createOscillator()
    const amp = audio.createGain()
    osc.type = type
    osc.frequency.setValueAtTime(freq, t + start)
    if (endFreq) osc.frequency.exponentialRampToValueAtTime(endFreq, t + start + dur)
    amp.gain.setValueAtTime(gain, t + start)
    amp.gain.exponentialRampToValueAtTime(0.0001, t + start + dur)
    osc.connect(amp).connect(audio.destination)
    osc.start(t + start)
    osc.stop(t + start + dur)
  }

  switch (sound) {
    case 'crash':
      tone(160, 0, 0.4, 'sawtooth', 0.05, 45)
      break
    case 'success':
      tone(660, 0, 0.12, 'sine', 0.07)
      tone(880, 0.1, 0.12, 'sine', 0.07)
      tone(1320, 0.2, 0.3, 'sine', 0.06)
      break
    case 'built':
      tone(523, 0, 0.14, 'triangle', 0.06)
      tone(659, 0.12, 0.14, 'triangle', 0.06)
      tone(784, 0.24, 0.14, 'triangle', 0.06)
      tone(1047, 0.36, 0.7, 'triangle', 0.06)
      tone(1319, 0.36, 0.7, 'sine', 0.04)
      tone(262, 0.36, 0.7, 'sine', 0.05)
      break
    case 'conquered':
      tone(392, 0, 0.16, 'triangle', 0.06)
      tone(523, 0.14, 0.16, 'triangle', 0.06)
      tone(659, 0.28, 0.16, 'triangle', 0.06)
      tone(784, 0.42, 0.16, 'triangle', 0.06)
      tone(1047, 0.56, 0.3, 'triangle', 0.06)
      tone(784, 0.84, 0.14, 'triangle', 0.06)
      tone(1047, 0.96, 0.14, 'triangle', 0.06)
      tone(1319, 1.08, 1.1, 'triangle', 0.06)
      tone(1568, 1.08, 1.1, 'sine', 0.04)
      tone(523, 1.08, 1.1, 'sine', 0.05)
      tone(262, 1.08, 1.1, 'sine', 0.05)
      break
    case 'drop':
      tone(320, 0, 0.08, 'triangle', 0.025, 160)
      break
    case 'rise':
      tone(220, 0, 0.3, 'sine', 0.05, 440)
      break
    case 'right':
      tone(784, 0, 0.1, 'sine', 0.06)
      tone(1175, 0.08, 0.18, 'sine', 0.06)
      break
    case 'wrong':
      tone(240, 0, 0.18, 'sine', 0.05, 200)
      break
    case 'pickup':
      tone(600, 0, 0.05, 'triangle', 0.035, 760)
      break
    case 'place':
      tone(180, 0, 0.12, 'sine', 0.08, 110)
      tone(1400, 0, 0.03, 'triangle', 0.02)
      break
    case 'remove':
      tone(520, 0, 0.16, 'triangle', 0.035, 260)
      break
  }
}

