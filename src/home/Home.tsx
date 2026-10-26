import { useState } from "react";
import { useProgress } from "../core/progress";
import { PHONE, useMedia } from "../core/useMedia";
import { PROJECTS } from "./projects";
import RealmMap from "./RealmMap";
import { projectStates } from "./shared";
import Toolbox from "./Toolbox";

// One tile of small waves, drawn in black: only its shape is used, as a mask.
const WAVES = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='80' height='36'%3E%3Cg fill='none' stroke='black' stroke-width='1.2' stroke-linecap='round'%3E%3Cpath d='M0 9q10-7 20 0t20 0 20 0 20 0'/%3E%3Cpath d='M-40 27q10-7 20 0t20 0 20 0 20 0 20 0 20 0' opacity='.7'/%3E%3C/g%3E%3C/svg%3E")`;

// The boats: height on the sea (%), seconds to cross, how far along the crossing they start, size, strength.
const BOATS = [
  { top: 14, secs: 110, phase: 20, size: 16, fade: 0.4 },
  { top: 48, secs: 80, phase: 55, size: 20, fade: 0.5 },
  { top: 78, secs: 130, phase: 100, size: 14, fade: 0.35 },
];

function Boat({ size }: { size: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M16 4v18" />
      <path d="M16 5 26 20H16Z" />
      <path d="M14 9 7 20h7" />
      <path d="M4 23h24l-4 5H8Z" />
    </svg>
  );
}

const NOTE_KEY = "bottleneck.desktop-note";

function readDismissed() {
  try {
    return localStorage.getItem(NOTE_KEY) === "1";
  } catch {
    return false;
  }
}

export default function Home() {
  const phone = useMedia(PHONE);
  const [noteGone, setNoteGone] = useState(readDismissed);
  const dismissNote = () => {
    setNoteGone(true);
    try {
      localStorage.setItem(NOTE_KEY, "1");
    } catch {
      /* the banner just comes back next visit */
    }
  };
  const progress = useProgress();
  const states = projectStates(progress);
  const next = PROJECTS.find((p) => states[p.id] === "next") ?? PROJECTS[0];
  const [picked, setPicked] = useState<string | null>(null);
  const project = PROJECTS.find((p) => p.id === picked) ?? next;

  return (
    <main className="pb-10 sm:pb-14">
      <div className="mx-auto max-w-[2200px] px-6 pt-6 sm:px-10 sm:pt-14 lg:px-16">
        {phone && !noteGone && (
          <div
            role="note"
            className="mb-4 flex items-start justify-between gap-3 rounded-xl border border-line bg-bg px-3 py-2 text-sm"
          >
            <p>PS: Building systems is easier on a bigger screen.</p>
            <button
              onClick={dismissNote}
              aria-label="Dismiss"
              className="shrink-0 rounded-full px-2 font-mono text-xs text-muted transition hover:text-fg"
            >
              ✕
            </button>
          </div>
        )}
        <div className="font-mono text-[11px] uppercase tracking-widest text-muted">
          Conquer each system
        </div>
        <h1 className="mt-3 font-mono text-[24px]">
          <b>The Realm of Systems</b>
          <span className="block text-lg leading-snug tracking-tighter text-muted">
            See why systems break at scale, then build ones that don't
          </span>
        </h1>
      </div>

      {/* The sea lies under the map: rows of small waves, drifting slowly. */}
      <div className="relative mt-4">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 overflow-hidden"
          style={{
            maskImage: "linear-gradient(to bottom, black 88%, transparent)",
          }}
        >
          {/* The waves are a mask over a plain fill, so they take the theme's line colour. Sliding the whole layer is cheap; the page behind never repaints. */}
          <div
            className="sea-drift absolute inset-y-0 -left-20 right-0 bg-line"
            style={{
              maskImage: WAVES,
              maskSize: "80px 36px",
              WebkitMaskImage: WAVES,
              WebkitMaskSize: "80px 36px",
            }}
          />
          {/* A few boats cross the sea, all the same way, each at its own height and pace. */}
          {BOATS.map((b, i) => (
            <div
              key={i}
              className="sea-boat absolute left-0 origin-top-left text-muted sm:scale-[1.7]"
              style={{
                top: `${b.top}%`,
                animationDuration: `${b.secs}s`,
                animationDelay: `${-b.phase}s`,
                opacity: b.fade,
              }}
            >
              <Boat size={b.size} />
            </div>
          ))}
        </div>
        <div className="relative mx-auto max-w-[2200px] px-4">
          <RealmMap
            states={states}
            selected={project.id}
            onSelect={setPicked}
          />
        </div>
      </div>

      <div className="relative mt-4">
        <div className="relative mx-auto max-w-[2200px] px-6 sm:px-10 lg:px-16">
          <Toolbox />
        </div>
      </div>
    </main>
  );
}
