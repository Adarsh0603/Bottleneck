import { useEffect, useState } from "react";

const SEEN_KEY = "bottleneck.welcome";

function readSeen() {
  try {
    return localStorage.getItem(SEEN_KEY) === "1";
  } catch {
    return false;
  }
}

// Shown once, on a learner's first visit.
export default function WelcomeDialog() {
  const [open, setOpen] = useState(() => !readSeen());

  const close = () => {
    setOpen(false);
    try {
      localStorage.setItem(SEEN_KEY, "1");
    } catch {
      /* it just shows again next visit */
    }
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={close}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="welcome-title"
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-full w-full max-w-md flex-col items-center overflow-y-auto rounded-2xl border border-line bg-bg p-6 text-center shadow-xl"
      >
        <svg
          viewBox="0 0 24 24"
          width={44}
          height={44}
          aria-hidden
          fill="none"
          stroke="currentColor"
          strokeWidth={1.8}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M12 3 4 6v6c0 4.5 3.2 7.8 8 9 4.8-1.2 8-4.5 8-9V6Z" />
          <path d="M9 9v7M9 9h6l-1.5 2.5L15 14H9" />
        </svg>
        <div className="mt-3 font-mono text-xs uppercase tracking-widest text-muted">
          Conquer each system
        </div>
        <h2
          id="welcome-title"
          className="mt-2 text-2xl font-semibold tracking-tight"
        >
          Welcome to Systemlands
        </h2>
        <p className="mt-3 text-sm text-muted">
          <b className="block  mt-3 text-sm">Brave Warrior!</b>
          <p className="mt-1 text-sm text-muted">
            Select any system, learn the tactics, analyze its collapse at scale,
            and build the architecture that survives the surge to conquer it.
          </p>
        </p>
        <button
          autoFocus
          onClick={close}
          className="mt-5 h-10 rounded-full bg-fg px-6 text-sm font-medium text-bg transition hover:opacity-85"
        >
          Begin the conquest
        </button>
      </div>
    </div>
  );
}
