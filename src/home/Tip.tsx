// A small red tag that points a first-time visitor at what to do next.
export default function Tip({ children, nudge = true }: { children: string; nudge?: boolean }) {
  return (
    <span
      role="note"
      className={`pointer-events-none inline-block whitespace-nowrap rounded-full bg-danger px-2.5 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider text-white ${nudge ? 'tip-nudge' : 'start-bob'}`}
    >
      {children}
    </span>
  )
}
