import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { CHEAT_SHEET, TopBar } from "../chrome";
import { Segmented, Select, Stepper } from "../controls";
import { ArrowIcon, Chip, ClockIcon, CrossIcon, GaugeIcon } from "../hud";
import { play } from "../sound";
import type { Level } from "../types";
import { useBottomInset } from "../useBottomInset";
import { COMPACT, SHORT, SIDE, useMedia } from "../useMedia";
import BuildScene from "./BuildScene";
import { PieceIcon } from "./pieces";
import { canDrop, drop, lift, remaining } from "./placement";
import { Source } from "../flow/nodes";
import { MS_PER_TICK, Running, TICKS_PER_SECOND } from "./run";
import {
  PIECE_NAMES,
  type BuildTask,
  type PieceKind,
  type Placement,
  type Settings,
} from "./types";

interface Drag {
  kind: PieceKind;
  fromPad?: string;
  startX: number;
  startY: number;
  x: number;
  y: number;
  moved: boolean;
}

const PROBLEM_DELAY_MS = 2500;

// The pad under a screen point, if any (pads carry a data-pad attribute).
const padAt = (x: number, y: number) =>
  document
    .elementFromPoint(x, y)
    ?.closest("[data-pad]")
    ?.getAttribute("data-pad") ?? null;

// A "Build it" chapter: drag pieces onto the floor while live traffic runs
// through whatever has been built, until the goal holds.
export default function BuildPlayer({
  task,
  chapters,
  index,
  doneChapters,
  onChapter,
  onCheatSheet,
  onStep,
  onSolved,
  onFinish,
}: {
  task: BuildTask;
  chapters: { title: string; level: Level }[];
  index: number;
  doneChapters: number[];
  onChapter: (index: number) => void;
  onCheatSheet?: () => void;
  onStep?: (step: number, isLastStep: boolean) => void;
  onSolved?: (step: number) => void;
  onFinish?: () => void;
}) {
  const [placed, setPlaced] = useState<Placement>({});
  const [selected, setSelected] = useState<PieceKind | null>(null);
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const [drag, setDrag] = useState<Drag | null>(null);
  const [hoverPad, setHoverPad] = useState<string | null>(null);
  const [solved, setSolved] = useState(false);
  const [briefOpen, setBriefOpen] = useState(!!task.brief);
  const [detailsOpen, setDetailsOpen] = useState(true);
  const [running, setRunning] = useState(!task.manualStart);
  const [, setFrame] = useState(0);
  const compact = useMedia(COMPACT);
  const short = useMedia(SHORT);
  // Wide screens get the controls in a side panel instead of over the floor.
  const side = useMedia(SIDE);
  const inset = useBottomInset<HTMLDivElement, HTMLDivElement>(side);
  const lastChapter = index === chapters.length - 1;

  const [settings, setSettings] = useState<Settings>(() =>
    Object.fromEntries((task.settings ?? []).map((s) => [s.id, s.initial])),
  );
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  // The live system, rebuilt from scratch whenever the placement or a setting changes.
  const runRef = useRef<Running | null>(null);
  if (!runRef.current)
    runRef.current = new Running(task.assemble({}, settings));
  const run = runRef.current;
  const lastTickAt = useRef(0);
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => {
      runRef.current!.step();
      lastTickAt.current = performance.now();
      setFrame((f) => f + 1);
    }, MS_PER_TICK);
    return () => clearInterval(id);
  }, [running]);
  // Stopping puts the run back at the start, ready to build again.
  const stop = () => {
    runRef.current = new Running(
      task.assemble(placedRef.current, settingsRef.current),
    );
    holdStart.current = null;
    setRunning(false);
  };

  const holdStart = useRef<number | null>(null);
  const problemSeen = useRef<{ text: string | null; since: number }>({
    text: null,
    since: 0,
  });
  const placedRef = useRef(placed);
  placedRef.current = placed;
  // Any change starts the run over, so nothing from the old build (numbers,
  // errors, a goal already reached) carries into the new one.
  const restart = (nextPlaced: Placement, nextSettings: Settings) => {
    runRef.current = new Running(task.assemble(nextPlaced, nextSettings));
    holdStart.current = null;
    setSolved(false);
    // Tasks with a Start button wait for it again, so the new build starts from zero.
    if (task.manualStart) setRunning(false);
  };
  const rebuild = (next: Placement) => {
    const current = placedRef.current;
    if (next === current) return;
    play(
      Object.keys(next).length < Object.keys(current).length
        ? "remove"
        : "place",
    );
    placedRef.current = next;
    setPlaced(next);
    restart(next, settingsRef.current);
  };
  const changeSetting = (id: string, value: number) => {
    const next = { ...settingsRef.current, [id]: value };
    settingsRef.current = next;
    setSettings(next);
    restart(placedRef.current, next);
    // Tuning a setting is asking to see what it does: no need to press Start.
    if (task.manualStart) setRunning(true);
  };
  const rebuildRef = useRef(rebuild);
  rebuildRef.current = rebuild;

  // Opening this chapter counts as reaching it; solving it completes it.
  const onStepRef = useRef(onStep);
  onStepRef.current = onStep;
  const onSolvedRef = useRef(onSolved);
  onSolvedRef.current = onSolved;
  useEffect(() => {
    onStepRef.current?.(0, false);
  }, []);

  const m = run.metrics();
  const tick = run.flow.tick;
  useEffect(() => {
    if (solved || tick === 0) return;
    const now = performance.now();
    if (task.check(m, placed, settings, run.flow)) {
      holdStart.current ??= now;
      if (now - holdStart.current >= task.holdSeconds * 1000) {
        setSolved(true);
        onSolvedRef.current?.(0);
        onStepRef.current?.(0, true);
        play("success");
      }
    } else {
      holdStart.current = null;
    }
  }, [solved, tick, task, m, placed, settings, run]);
  // Traffic right now: it can rise and fall during a build.
  const rps = !running
    ? 0
    : run.flow
        .all()
        .reduce(
          (sum, n) =>
            sum + (n instanceof Source ? n.rate * TICKS_PER_SECOND : 0),
          0,
        );
  const raw =
    solved || tick === 0
      ? null
      : (task.problem?.(m, placed, settings, run.flow) ?? null);
  // A problem only shows once it has lasted a moment, and never while the goal
  // holds: a brief blip on a build that works would make the learner doubt it.
  if (raw !== problemSeen.current.text)
    problemSeen.current = { text: raw, since: performance.now() };
  const found =
    raw &&
    holdStart.current === null &&
    performance.now() - problemSeen.current.since >= PROBLEM_DELAY_MS
      ? raw
      : null;
  const problem = found;
  // On a small screen the goal and title can be folded away to show more floor.
  const focus = compact && !detailsOpen && !solved;
  const holdProgress =
    holdStart.current === null
      ? 0
      : Math.min(
          1,
          (performance.now() - holdStart.current) / (task.holdSeconds * 1000),
        );

  // Dragging: from the toolbox or off a pad. A press that doesn't move is a
  // tap: in the toolbox it picks the piece for tap-to-place.
  const dragRef = useRef<Drag | null>(null);
  dragRef.current = drag;
  const startDrag = (
    kind: PieceKind,
    fromPad: string | undefined,
    e: ReactPointerEvent,
  ) => {
    e.preventDefault();
    setDrag({
      kind,
      fromPad,
      startX: e.clientX,
      startY: e.clientY,
      x: e.clientX,
      y: e.clientY,
      moved: false,
    });
  };
  const dragging = drag !== null;
  useEffect(() => {
    if (!dragging) return;
    const move = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const moved =
        d.moved || Math.hypot(e.clientX - d.startX, e.clientY - d.startY) > 6;
      if (moved && !d.moved) play("pickup");
      setDrag({ ...d, x: e.clientX, y: e.clientY, moved });
      setHoverPad(moved ? padAt(e.clientX, e.clientY) : null);
    };
    const up = (e: PointerEvent) => {
      const d = dragRef.current;
      setDrag(null);
      setHoverPad(null);
      if (!d) return;
      if (!d.moved) {
        if (d.fromPad === undefined) {
          if (selectedRef.current !== d.kind) play("pickup");
          setSelected((s) => (s === d.kind ? null : d.kind));
        } else {
          // Tapping a placed piece with another one picked swaps it in.
          tapPadRef.current(d.fromPad);
        }
        return;
      }
      const pad = padAt(e.clientX, e.clientY);
      const current = placedRef.current;
      if (pad && canDrop(task, current, pad, d.kind, d.fromPad))
        rebuildRef.current(drop(task, current, pad, d.kind, d.fromPad));
      else if (d.fromPad !== undefined)
        rebuildRef.current(lift(current, d.fromPad)); // dragged off: back to the toolbox
    };
    const cancel = () => {
      setDrag(null);
      setHoverPad(null);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
    };
  }, [dragging, task]);

  // Tap-to-place: with a piece picked in the toolbox, tapping a pad drops it.
  const tapPad = (padId: string) => {
    if (!selected || !canDrop(task, placed, padId, selected)) return;
    const next = drop(task, placed, padId, selected);
    rebuild(next);
    if ((remaining(task, next)[selected] ?? 0) <= 0) setSelected(null);
  };
  const tapPadRef = useRef(tapPad);
  tapPadRef.current = tapPad;

  const left = remaining(task, placed);
  const activeKind = drag?.moved ? drag.kind : selected;

  const toolboxButtons = task.toolbox.map(({ kind }) => {
    const count = left[kind] ?? 0;
    return (
      <button
        key={kind}
        disabled={count <= 0}
        onPointerDown={(e) => count > 0 && startDrag(kind, undefined, e)}
        aria-pressed={selected === kind}
        aria-label={`${PIECE_NAMES[kind]}, ${count} left. Drag onto a pad, or tap then tap a pad.`}
        className={`flex touch-none items-center gap-2 rounded-xl border bg-bg/90 py-1.5 pl-1.5 pr-3 text-sm backdrop-blur transition disabled:opacity-35 ${
          selected === kind
            ? "border-fg ring-1 ring-fg"
            : "border-line hover:border-fg"
        } ${count > 0 ? "cursor-grab active:cursor-grabbing" : ""}`}
      >
        <PieceIcon kind={kind} size={34} />
        <span>{PIECE_NAMES[kind]}</span>
        <span className="ml-auto font-mono text-xs text-muted">×{count}</span>
      </button>
    );
  });
  // Settings appear once the piece they adjust is on the floor.
  const shownSettings = (task.settings ?? []).filter(
    (s) =>
      Object.values(placed).includes(s.when) ||
      task.fixed.some((f) => f.kind === s.when),
  );
  const settingStepper = (s: (typeof shownSettings)[number]) => (
    <Stepper
      value={settings[s.id]}
      min={s.min}
      max={s.max}
      label={s.label}
      onChange={(v) =>
        changeSetting(
          s.id,
          settings[s.id] + (v > settings[s.id] ? s.step : -s.step),
        )
      }
    />
  );
  const startButton = task.manualStart && !solved && (
    <button
      onClick={running ? stop : () => setRunning(true)}
      className={`rounded-xl px-4 py-1.5 text-sm font-medium transition ${side ? "w-full py-2.5" : ""} ${
        running
          ? "border border-line bg-bg/90 backdrop-blur hover:border-fg"
          : "bg-fg text-bg hover:opacity-85"
      }`}
    >
      {running ? "Stop and edit" : "Start requests"}
    </button>
  );
  const situationButton = task.brief && (!briefOpen || side) && (
    <button
      onClick={() => setBriefOpen((o) => !o)}
      aria-expanded={briefOpen}
      className="rounded-xl border border-line bg-bg/90 px-3 py-1.5 text-sm backdrop-blur transition hover:border-fg"
    >
      Situation
    </button>
  );
  // The situation pops up in the middle of the floor.
  const briefCard = briefOpen && task.brief && (
    <div
      className={`pointer-events-none absolute inset-y-0 left-0 z-30 flex items-center justify-center p-4 ${side ? "right-88" : "right-0"}`}
    >
      <div className="pointer-events-auto flex max-h-full w-full max-w-lg flex-col rounded-2xl border border-line bg-bg p-5 shadow-xl">
        <div className="font-mono text-[10px] uppercase tracking-widest text-muted">
          The situation
        </div>
        <div className="mt-3 min-h-0 flex-1 space-y-3 overflow-y-auto text-base">
          {task.brief.map((line) => (
            <p key={line}>{line}</p>
          ))}
        </div>
        <button
          onClick={() => setBriefOpen(false)}
          className="mt-4 h-10 shrink-0 self-start rounded-full bg-fg px-6 text-sm font-medium text-bg transition hover:opacity-85"
        >
          Start building
        </button>
      </div>
    </div>
  );
  const problemCard = problem && !briefOpen && (
    <div
      className={`max-w-md rounded-xl border border-danger bg-bg/90 p-3 text-sm backdrop-blur ${side ? "" : "mb-3"}`}
      role="status"
    >
      <div className="font-mono text-[10px] uppercase tracking-widest text-danger">
        What’s going wrong
      </div>
      <p className="mt-1">{problem}</p>
    </div>
  );
  const hint = selected
    ? `Now tap a pad to place the ${PIECE_NAMES[selected].toLowerCase()}.`
    : !running
      ? "Place your pieces, then press Start requests. Changing anything restarts the run."
      : task.sub;
  // The way on only appears once the goal holds.
  const finishButton = solved && (
    <button
      onClick={lastChapter ? onFinish : () => onChapter(index + 1)}
      className="pointer-events-auto h-10 shrink-0 animate-pulse rounded-full bg-fg px-6 text-sm font-medium text-bg transition hover:opacity-85"
    >
      {lastChapter ? "Finish ✓" : "Next →"}
    </button>
  );
  // Tells the learner a run takes a while to judge, and that any change starts it over.
  const elapsed = Math.floor(tick / TICKS_PER_SECOND);
  const testNote = task.testSeconds
    ? elapsed < task.testSeconds
      ? `Testing your build: ${elapsed}s of about ${task.testSeconds}s. Any change restarts the test.`
      : "Almost done. The goal has to hold until the bar fills."
    : `The goal has to hold for ${task.holdSeconds}s. Any change restarts the test.`;
  const goalCard = (
    <div
      className={`max-w-md rounded-xl border transition ${side ? "w-full p-3" : short || focus ? "mb-2 px-3 py-2" : "mb-3 p-3"} ${
        solved
          ? "border-fg bg-fg text-bg"
          : "border-line bg-bg/80 backdrop-blur"
      }`}
    >
      <div
        className={`font-mono text-[10px] uppercase tracking-widest opacity-70 ${!side && (short || focus) ? "hidden" : ""}`}
      >
        {solved ? "Built" : "Goal"}
      </div>
      <div
        className={
          focus ? "truncate text-xs font-medium" : "mt-1 text-sm font-medium"
        }
      >
        {solved ? task.win : focus ? (task.goalShort ?? task.goal) : task.goal}
      </div>
      {!solved && running && !focus && (
        <div className="mt-1 text-xs opacity-70">{testNote}</div>
      )}
      {!solved && (
        <div
          className={`${focus ? "mt-1.5" : "mt-2"} h-1 overflow-hidden rounded-full bg-line`}
        >
          <div
            className="h-full rounded-full bg-fg transition-[width]"
            style={{ width: `${holdProgress * 100}%` }}
          />
        </div>
      )}
    </div>
  );

  return (
    <div
      ref={inset.root}
      className="relative h-[calc(100svh-57px)] min-h-[260px] w-full select-none overflow-hidden"
    >
      <div
        className={`absolute inset-y-0 left-0 ${side ? "right-88" : "right-0"}`}
      >
        <BuildScene
          task={task}
          run={run}
          placed={placed}
          settings={settings}
          lastTickAt={lastTickAt}
          dragKind={activeKind}
          hoverPad={hoverPad}
          onPadClick={tapPad}
          onPieceDown={(padId, e) => startDrag(placed[padId], padId, e)}
        />
      </div>

      {/* Top: chapter menu, sound and live numbers. */}
      <div
        className={`pointer-events-none absolute left-0 top-0 z-20 ${side ? "right-88" : "right-0"} ${short ? "space-y-1.5 p-2" : "space-y-2 p-3 sm:space-y-3 sm:p-4"}`}
      >
        <TopBar
          title={task.title}
          chapters={chapters}
          index={index}
          doneChapters={doneChapters}
          onChapter={onChapter}
          extra={onCheatSheet && { title: CHEAT_SHEET, onOpen: onCheatSheet }}
        />
        <div
          className={`flex gap-2 ${compact ? "no-scrollbar pointer-events-auto -mx-3 overflow-x-auto px-3" : "flex-wrap"}`}
        >
          <Chip
            icon={<ArrowIcon />}
            title="Traffic"
            value={`${Math.round(rps)} req/s`}
          />
          <Chip
            icon={<CrossIcon />}
            title="Errors"
            value={`${m.dropRate.toFixed(0)}%`}
            bad={m.dropRate > 1}
          />
          {(
            task.watch ?? [
              { kind: "busy", key: "", label: "Busiest server" } as const,
            ]
          ).map((w) => {
            if (w.kind === "note") {
              const { text, bad } = w.read(run.flow);
              return (
                <Chip
                  key={w.label}
                  icon={<ClockIcon />}
                  title={w.label}
                  value={text}
                  bad={bad}
                />
              );
            }
            if (w.kind === "latency") {
              const ms = m.latency[w.key] ?? 0;
              return (
                <Chip
                  key={w.key}
                  icon={<ClockIcon />}
                  title={w.label}
                  value={`${(ms / 1000).toFixed(2)}s`}
                  bad={ms > w.limitMs}
                />
              );
            }
            const busy = w.key ? (m.busy[w.key] ?? 0) : m.busiest;
            return (
              <Chip
                key={w.key || "busiest"}
                icon={<GaugeIcon />}
                title={w.label}
                value={`${Math.round(busy * 100)}%`}
                bad={busy >= 0.9}
              />
            );
          })}
        </div>
        {side && task.brief && (
          <div className="pointer-events-auto flex flex-col items-start gap-2">
            {situationButton}
          </div>
        )}
      </div>

      {side ? (
        <>
          {/* Desktop: the side panel is the inventory and the settings. */}
          <aside className="absolute inset-y-0 right-0 z-20 flex w-88 flex-col gap-5 overflow-y-auto border-l border-line bg-bg p-4">
            <section>
              <div className="font-mono text-[10px] uppercase tracking-widest text-muted">
                Pieces
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2">
                {toolboxButtons}
              </div>
            </section>
            {[...new Set(shownSettings.map((s) => s.when))].map((when) => (
              <section key={when}>
                <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-widest text-muted">
                  <PieceIcon kind={when} size={22} />
                  {PIECE_NAMES[when]}
                </div>
                <div className="mt-2 space-y-2">
                  {shownSettings
                    .filter((s) => s.when === when)
                    .map((s) => (
                      <div
                        key={s.id}
                        className="flex items-center justify-between gap-3"
                      >
                        {s.options ? (
                          <>
                            <span className="text-sm font-medium capitalize">
                              {s.label}
                            </span>
                            <Select
                              label={s.label}
                              value={settings[s.id]}
                              options={s.options.map((label, i) => ({
                                value: s.min + i * s.step,
                                label,
                              }))}
                              onChange={(v) => changeSetting(s.id, v)}
                            />
                          </>
                        ) : (
                          settingStepper(s)
                        )}
                      </div>
                    ))}
                </div>
              </section>
            ))}
            <div className="mt-auto">{startButton}</div>
          </aside>

          {/* Canvas: goal, hint, situation and what's going wrong. */}
          <div
            ref={inset.bottom}
            className="pointer-events-none absolute bottom-0 left-0 right-88 z-20 px-4 pb-4 pt-10"
          >
            <div className="pointer-events-auto mx-auto flex max-w-md flex-col items-center gap-2 text-center">
              {problemCard}
              {goalCard}
              {finishButton}
            </div>
          </div>
        </>
      ) : (
        <div
          ref={inset.bottom}
          className={`pointer-events-none absolute inset-x-0 bottom-0 z-20 bg-linear-to-t from-bg via-bg/90 to-transparent ${
            short
              ? "px-3 pb-2 pt-6"
              : "px-3 pb-4 pt-10 sm:px-4 sm:pb-6 sm:pt-16"
          }`}
        >
          <div className="mx-auto flex max-w-5xl flex-col gap-3 sm:flex-row sm:items-end sm:justify-between sm:gap-5">
            <div className="pointer-events-auto min-w-0">
              {problemCard}
              {goalCard}
              <h2
                className={`font-semibold tracking-tight ${focus ? "hidden" : ""} ${short ? "text-lg" : "text-xl sm:text-2xl"}`}
              >
                {task.title}
              </h2>
              <p className={`mt-1 text-sm text-muted ${focus ? "hidden" : ""}`}>
                {hint}
              </p>

              {/* The toolbox. touch-none so a finger drag moves the piece
                  instead of scrolling the page. */}
              <div className="mt-3 flex flex-wrap gap-2">
                {toolboxButtons}
                {compact && !solved && (
                  <button
                    onClick={() => setDetailsOpen((o) => !o)}
                    aria-expanded={detailsOpen}
                    className="rounded-xl border border-line bg-bg/90 px-3 py-1.5 text-sm backdrop-blur transition hover:border-fg"
                  >
                    {detailsOpen ? "Hide goal ▾" : "Goal ▴"}
                  </button>
                )}
                {situationButton}
                {shownSettings.map((s) => (
                  <div key={s.id} className="flex items-center gap-2">
                    <PieceIcon kind={s.when} size={28} />
                    {s.options ? (
                      <>
                        <span className="text-sm font-medium">{s.label}</span>
                        <Segmented
                          scroll
                          value={settings[s.id]}
                          options={s.options.map((label, i) => ({
                            value: s.min + i * s.step,
                            label,
                          }))}
                          onChange={(v) => changeSetting(s.id, v)}
                        />
                      </>
                    ) : (
                      settingStepper(s)
                    )}
                  </div>
                ))}
                {startButton}
              </div>
            </div>

            {finishButton}
          </div>
        </div>
      )}

      {briefCard}

      {/* The piece following the pointer while dragging. */}
      {drag?.moved && (
        <div
          className="pointer-events-none fixed z-50 -translate-x-1/2 -translate-y-1/2 opacity-90"
          style={{ left: drag.x, top: drag.y }}
        >
          <PieceIcon kind={drag.kind} size={64} />
        </div>
      )}
    </div>
  );
}
