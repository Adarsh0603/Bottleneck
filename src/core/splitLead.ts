const ABBREVIATION = /\b(e\.g|i\.e|vs|etc)\.?$/i

// The first sentence of a point is the thing to say; the rest is detail.
export function splitLead(text: string): { lead: string; rest: string } {
  const end = /[.!?]["”’)]?\s+(?=[A-Z“"(])/g
  for (let m = end.exec(text); m; m = end.exec(text)) {
    if (ABBREVIATION.test(text.slice(0, m.index + 1))) continue
    const at = m.index + m[0].trimEnd().length
    return { lead: text.slice(0, at), rest: text.slice(at).trim() }
  }
  return { lead: text, rest: '' }
}
