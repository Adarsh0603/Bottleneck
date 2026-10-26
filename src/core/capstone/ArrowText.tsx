// Button text with a leading "←" or trailing "→" drawn as an SVG. The glyphs
// come from a fallback font on phones and sit above or below the text; the SVG
// is centred on the line with the text.
const Arrow = ({ flip }: { flip?: boolean }) => (
  <svg
    viewBox="0 0 16 16"
    width="1em"
    height="1em"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.6"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden
    className={`shrink-0 ${flip ? 'rotate-180' : ''}`}
  >
    <path d="M2 8h12M9.5 3.5 14 8l-4.5 4.5" />
  </svg>
)

export default function ArrowText({ children }: { children: string }) {
  const back = children.startsWith('←')
  const forward = children.endsWith('→')
  const text = children.replace(/^←\s*/, '').replace(/\s*→$/, '')
  return (
    <span className="inline-flex items-center gap-1.5">
      {back && <Arrow flip />}
      <span>{text}</span>
      {forward && <Arrow />}
    </span>
  )
}
