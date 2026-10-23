import { resetProgress, useProgress } from "../core/progress";
import { TOPICS, TRACKS, type TopicEntry } from "../topics/registry";
import { useState } from "react";
import HeroScene from "./HeroScene";
import TopicThumb from "./TopicThumb";
import { ContinueButton, Credit, ViewToggle, type HomeView } from "./parts";
import {
  actionLabel,
  nextTopic,
  openTopic,
  statusOf,
  topicNumber,
} from "./shared";

export default function HomeList({
  onView,
}: {
  onView: (view: HomeView) => void;
}) {
  const progress = useProgress();
  const next = nextTopic(progress);

  return (
    <div className="relative">
      {/* The scenes' isometric floor, faintly, behind the top of the page. */}
      <div
        aria-hidden
        className="iso-backdrop pointer-events-none absolute inset-x-0 top-0 h-[1000px]"
      />

      <main className="relative mx-auto max-w-6xl px-4 py-10 sm:py-14">
        <div className="mb-8 flex justify-end">
          <ViewToggle view="list" onChange={onView} />
        </div>

        <section className="grid items-center gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,440px)]">
          <div className="max-w-2xl">
            <div className="font-mono text-[11px] uppercase tracking-widest text-muted">
              System design, visually
            </div>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
              See why systems break, then build ones that don't.
            </h1>
            <p className="mt-3 text-muted">
              Watch systems overload, fail and recover, then fix them yourself.
              From your first server to distributed consensus.
            </p>
            <ContinueButton className="mt-6" />
          </div>
          <div className="hidden lg:block">
            <HeroScene />
          </div>
        </section>

        {TRACKS.map((track) => {
          const topics = TOPICS.filter((t) => t.track === track.id);
          return (
            <section key={track.id} className="mt-12">
              <div className="mb-4 flex items-baseline gap-3">
                <h2 className="text-lg font-semibold tracking-tight">
                  {track.title}
                </h2>
                <span className="rounded-full border border-line bg-bg px-2 py-0.5 font-mono text-[10px] uppercase tracking-widest text-muted">
                  {track.level}
                </span>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {topics.map((t) => (
                  <TopicCard
                    key={t.id}
                    topic={t}
                    isNext={t === next}
                    onOpen={() => openTopic(t)}
                  />
                ))}
              </div>
            </section>
          );
        })}

        <footer className="mt-16 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-6 text-xs text-muted">
          <Credit />
          <span className="flex flex-wrap items-center gap-3">
            <span>Progress is saved in this browser only.</span>
            {Object.keys(progress).length > 0 && (
              <button
                onClick={() => {
                  if (
                    window.confirm("Reset all progress? This can’t be undone.")
                  )
                    resetProgress();
                }}
                className="font-mono underline-offset-4 transition hover:text-fg hover:underline"
              >
                Reset progress
              </button>
            )}
          </span>
        </footer>
      </main>
    </div>
  );
}

function TopicCard({
  topic,
  isNext,
  onOpen,
}: {
  topic: TopicEntry;
  isNext: boolean;
  onOpen: () => void;
}) {
  const progress = useProgress();
  const status = statusOf(progress, topic);
  const label = topicNumber(topic);
  const [live, setLive] = useState(false);

  if (status === "soon" || !topic.chapters) {
    return (
      <div className="rounded-2xl border cursor-pointer border-dashed border-line bg-bg p-4">
        <div className="mb-4 h-28 opacity-70">
          <TopicThumb topic={topic} live={false} />
        </div>
        <div className="flex items-center justify-between font-mono text-xs text-muted">
          <span>{label}</span>
          <span className="rounded-full border border-line px-2 py-0.5 text-[10px] uppercase tracking-widest">
            Soon
          </span>
        </div>
        <h3 className="mt-3 font-medium text-muted">{topic.title}</h3>
        <p className="mt-1 text-sm leading-6 text-muted">{topic.pitch}</p>
      </div>
    );
  }

  // Rows inside a <button> don't stretch to its width on their own, so each
  // row is made full width explicitly.
  return (
    <button
      onClick={onOpen}
      onPointerEnter={() => setLive(true)}
      onPointerLeave={() => setLive(false)}
      onFocus={() => setLive(true)}
      onBlur={() => setLive(false)}
      className={`group flex flex-col rounded-2xl border cursor-pointer bg-bg p-4 text-left transition hover:border-fg ${
        isNext || status === "done" ? "border-fg" : "border-line"
      }`}
    >
      <div className="mb-4 h-44 w-full rounded-xl bg-subtle/60 p-2">
        <TopicThumb topic={topic} live={live} />
      </div>
      <div className="flex w-full items-center justify-between font-mono text-xs text-muted">
        <span>{label}</span>
        {status === "done" ? (
          <span className="rounded-full bg-fg px-2 py-0.5 text-[10px] uppercase tracking-widest text-bg">
            ✓ Completed
          </span>
        ) : isNext ? (
          <span className="rounded-full bg-fg px-2 py-0.5 text-[10px] uppercase tracking-widest text-bg">
            Next
          </span>
        ) : status === "started" ? (
          <span className="rounded-full border border-fg px-2 py-0.5 text-[10px] uppercase tracking-widest text-fg">
            In progress
          </span>
        ) : null}
      </div>
      <h3 className="mt-3 font-medium">{topic.title}</h3>
      <p className="mt-1 flex-1 text-sm leading-6 text-muted">{topic.pitch}</p>

      <div className="mt-3 w-full text-right font-mono text-[11px] text-muted transition group-hover:text-fg">
        {actionLabel(status)} →
      </div>
    </button>
  );
}
