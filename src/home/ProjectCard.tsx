import { TOPICS } from "../topics/registry";
import {
  conceptOf,
  isBuilt,
  projectNumber,
  TIER_NAMES,
  type Project,
} from "./projects";
import { openTopic, type ProjectState } from "./shared";

const STATE_TEXT: Record<ProjectState, string> = {
  done: "Conquered",
  next: "Next on the road",
  fog: "Not yet explored",
};

// The chosen project: what it is, which concepts it needs, and a way in.
// Every concept opens at any time; nothing here is locked.
// It stands on the map over its castle, with a small pointer to it: `pointer` is how far
// the pointer sits from the card's middle, and `below` puts the card under the castle.
export default function ProjectCard({
  project,
  state,
  pointer = 0,
  below = false,
  plain = false,
}: {
  project: Project;
  state: ProjectState;
  pointer?: number;
  below?: boolean;
  // No pointer: the card stands on its own, not over a castle.
  plain?: boolean;
}) {
  const built = isBuilt(project);
  const topic = TOPICS.find((t) => t.id === project.id);
  return (
    <section
      className="relative rounded-2xl border border-line bg-bg p-4 shadow-xl"
      aria-live="polite"
    >
      {!plain && (
        <span
          aria-hidden
          className={`absolute h-3 w-3 -translate-x-1/2 rotate-45 border-line bg-bg ${below ? "-top-1.5 border-l border-t" : "-bottom-1.5 border-b border-r"}`}
          style={{ left: `calc(50% + ${pointer}px)` }}
        />
      )}
      <div className="font-mono text-[11px] uppercase tracking-widest text-muted">
        {TIER_NAMES[project.tier]} · System {projectNumber(project)} ·{" "}
        <span className={state === "next" ? "text-danger" : ""}>
          {STATE_TEXT[state]}
        </span>
      </div>
      <h2 className="mt-1 text-lg font-semibold tracking-tight">
        {project.name}
      </h2>
      {topic?.pitch && <p className="mt-1 text-sm text-muted">{topic.pitch}</p>}

      <div className="mt-3 font-mono text-[11px] uppercase tracking-widest text-muted">
        Tactics you will use
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {project.needs.map((name) => {
          const c = conceptOf(name);
          const lesson = c.built && TOPICS.find((t) => t.id === c.built);
          return lesson ? (
            <button
              key={name}
              onClick={() => openTopic(lesson)}
              className="cursor-pointer rounded-full border border-line px-2.5 py-1 font-mono text-xs transition hover:border-fg"
            >
              {name}
            </button>
          ) : (
            <span
              key={name}
              className="rounded-full border border-dashed border-line px-2.5 py-1 font-mono text-xs text-muted"
            >
              {name} · coming
            </span>
          );
        })}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        {built && topic ? (
          <button
            onClick={() => openTopic(topic)}
            className="cursor-pointer rounded-full bg-fg px-6 py-2 text-sm font-medium text-bg transition hover:opacity-90"
          >
            Enter
          </button>
        ) : (
          <span className="rounded-full border border-dashed border-line px-5 py-2.5 text-sm text-muted">
            Coming soon
          </span>
        )}
      </div>
    </section>
  );
}
