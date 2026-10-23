import { continueTarget, useProgress } from "../core/progress";
import { navigate } from "../core/router";
import { TOPICS } from "../topics/registry";
import { chapterCounts } from "./shared";

export type HomeView = "map" | "list";

// "Continue · Load balancing →", shown once something is started. It opens
// the topic from its first chapter.
export function ContinueButton({ className = "" }: { className?: string }) {
  const progress = useProgress();
  const resume = continueTarget(progress, chapterCounts);
  const topic = resume && TOPICS.find((t) => t.id === resume.topic);
  if (!resume || !topic) return null;

  return (
    <button
      onClick={() =>
        navigate({
          page: "topic",
          topic: resume.topic,
          chapter: 0,
          step: 0,
        })
      }
      className={`flex w-full max-w-md items-center justify-between gap-4 rounded-2xl bg-fg px-5 py-4 text-left text-bg transition hover:opacity-90 ${className}`}
    >
      <span>
        <span className="block font-mono text-[10px] uppercase tracking-widest opacity-70">
          Continue
        </span>
        <span className="mt-0.5 block font-medium">{topic.title}</span>
      </span>
      <span aria-hidden>→</span>
    </button>
  );
}

// "Made by Adarsh Verma · Source on GitHub"
export function Credit({ className = "" }: { className?: string }) {
  const link = "underline-offset-4 transition hover:text-fg hover:underline";
  return (
    <span className={className}>
      {/* Made by{" "}
      <a
        href="https://github.com/Adarsh0603"
        target="_blank"
        rel="noreferrer"
        className={`text-fg ${link}`}
      >
        Adarsh Verma
      </a>
      <span className="mx-1.5" aria-hidden>
        ·
      </span> */}
      <a
        href="https://github.com/Adarsh0603/Bottleneck"
        target="_blank"
        rel="noreferrer"
        className={link}
      >
        Source on GitHub
      </a>
    </span>
  );
}

export function ViewToggle({
  view,
  onChange,
}: {
  view: HomeView;
  onChange: (view: HomeView) => void;
}) {
  return (
    <div
      className="inline-flex rounded-full border border-line bg-bg/80 p-0.5 font-mono text-xs backdrop-blur"
      role="group"
      aria-label="Home view"
    >
      {(["map", "list"] as const).map((v) => (
        <button
          key={v}
          onClick={() => onChange(v)}
          aria-pressed={view === v}
          className={`rounded-full px-3 py-1 capitalize transition ${view === v ? "bg-fg text-bg" : "text-muted hover:text-fg"}`}
        >
          {v}
        </button>
      ))}
    </div>
  );
}
