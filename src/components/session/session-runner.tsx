"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";

import {
  Callout,
  Card,
  HeroNumber,
  SessionRow,
  Stepper,
  TopBar,
} from "@/components/ui/kit";
import { TONE } from "@/components/day-accents";
import { RestBar, useRestTimer, useWakeLock } from "@/components/session/rest-timer";
import {
  formatWeight,
  nextLoadableWeight,
  plateBreakdown,
  type EngineConfig,
  type LiftState,
} from "@/lib/engine";
import { replayEngine, type ReplayPrimary } from "@/lib/engine/replay";
import { weightLabelFor, type ResolvedExercise } from "@/lib/domain/plan";
import {
  createLocalSession,
  recordLocalSet,
  undoLocalFailure,
  finishLocalSession,
  type LocalSessionState,
} from "@/lib/offline/local-session";
import type { SessionKey } from "@/lib/offline/queue";
import {
  enqueueAndFlush,
  enqueueOp,
  flush,
  getLocalSession,
  putLocalSession,
} from "@/lib/offline/syncer";
import { cn } from "@/lib/cn";

interface LoggedSet {
  programExerciseId: string | null;
  setIndex: number;
  reps: number | null;
  seconds: number | null;
  weightKg: number | null;
  missedRange: boolean;
}

/** What the client needs to run the regression engine locally. */
export interface ReplayContext {
  lift: LiftState | null;
  primary: ReplayPrimary | null;
  week: number;
  config: EngineConfig;
}

/** `value` is reps or seconds, whichever the exercise's effort counts;
    `weightKg` is the load actually moved, not necessarily the plan's. */
type LogMap = Record<
  string,
  { value: number; missed: boolean; weightKg: number | null }
>;

const keyOf = (exerciseId: string, setIndex: number) =>
  `${exerciseId}:${setIndex}`;

export function SessionRunner({
  sessionId,
  sessionKey,
  label,
  exercises,
  initialLogs,
  initialUndone,
  replayCtx,
  autoRest,
  sound,
  vibration,
  keepAwake,
  showPlates,
  targetRir,
}: {
  sessionId: string;
  sessionKey: SessionKey;
  label: string;
  exercises: ResolvedExercise[];
  initialLogs: LoggedSet[];
  /** Failures already undone in earlier flushes of this session. */
  initialUndone: Array<{ position: number; setIndex: number }>;
  replayCtx: ReplayContext;
  autoRest: boolean;
  sound: boolean;
  vibration: boolean;
  keepAwake: boolean;
  showPlates: boolean;
  targetRir: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [dismissedFailure, setDismissedFailure] = useState<string | null>(null);
  const [undone, setUndone] = useState(initialUndone);
  const [repsOpen, setRepsOpen] = useState(false);
  /** Set index being corrected via its pill — overwrites in place. */
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [confirmFinish, setConfirmFinish] = useState(false);
  const [finishNotes, setFinishNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const finishRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (confirmFinish) {
      finishRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [confirmFinish]);

  const [logs, setLogs] = useState<LogMap>(() => {
    const map: LogMap = {};
    for (const l of initialLogs) {
      const value = l.reps ?? l.seconds;
      if (!l.programExerciseId || value == null) continue;
      map[keyOf(l.programExerciseId, l.setIndex)] = {
        value,
        missed: l.missedRange,
        weightKg: l.weightKg,
      };
    }
    return map;
  });

  /** Load the athlete moved to with the stepper, per exercise: what the
      next set of it goes on until another set says otherwise. */
  const [weights, setWeights] = useState<Record<string, number>>({});

  /** The persisted mirror of this session — survives a killed tab. */
  const localRef = useRef<LocalSessionState | null>(null);
  async function withLocal(
    mutate: (s: LocalSessionState) => LocalSessionState,
  ): Promise<void> {
    let s =
      localRef.current ??
      (await getLocalSession(sessionId)) ??
      createLocalSession(sessionId, sessionKey, new Date().toISOString());
    s = mutate(s);
    localRef.current = s;
    await putLocalSession(s);
  }

  /**
   * The regression banner, computed HERE with the same fold the server
   * runs at flush time. No network between a missed set and the answer.
   */
  const replay = useMemo(() => {
    const { primary } = replayCtx;
    if (!primary) return null;
    const primaryExercise = exercises.find(
      (e) => e.id === primary.programExerciseId,
    );
    if (!primaryExercise) return null;
    const replayLogs = [];
    for (let i = 0; i < primaryExercise.sets; i++) {
      const entry = logs[keyOf(primaryExercise.id, i)];
      if (!entry) continue;
      replayLogs.push({
        programExerciseId: primaryExercise.id,
        position: primaryExercise.position,
        setIndex: i,
        reps: primaryExercise.effort === "seconds" ? null : entry.value,
        seconds: primaryExercise.effort === "seconds" ? entry.value : null,
        // The hold lands on the weight that was actually missed.
        weightKg: entry.weightKg ?? primaryExercise.weightKg,
      });
    }
    return replayEngine({
      sessionId,
      lift: replayCtx.lift,
      primary,
      logs: replayLogs,
      undone,
      week: replayCtx.week,
      config: replayCtx.config,
    });
  }, [exercises, logs, undone, replayCtx, sessionId]);

  const lastLiveFailure =
    replay?.events.filter((e) => !e.undone).at(-1)?.sourceSet ?? null;
  const failureKey = lastLiveFailure
    ? `${lastLiveFailure.position}:${lastLiveFailure.setIndex}`
    : null;
  const banner =
    replay?.banner && failureKey && failureKey !== dismissedFailure
      ? replay.banner
      : null;

  const firstUnfinished = useMemo(() => {
    const idx = exercises.findIndex((ex) => {
      const done = countDone(logs, ex.id, ex.sets);
      return done < ex.sets;
    });
    return idx === -1 ? exercises.length - 1 : idx;
  }, [exercises, logs]);

  const [exIndex, setExIndex] = useState(firstUnfinished);
  const [pendingRir, setPendingRir] = useState<number | null>(null);
  const exercise = exercises[Math.min(exIndex, exercises.length - 1)];

  const { rest, flash, start, stop, extend, resume } = useRestTimer({
    sound,
    vibration,
    // Persist the deadline: a reload mid-rest keeps counting.
    onChange: (snapshot) => void withLocal((s) => ({ ...s, rest: snapshot })),
  });
  useWakeLock(keepAwake);

  /* Restore what only this device knows: unflushed sets, undos and the
     rest deadline survive a killed tab. Local entries win over server. */
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const local = await getLocalSession(sessionId);
      if (!local || cancelled) return;
      localRef.current = local;
      setLogs((prev) => {
        const next = { ...prev };
        for (const [k, entry] of Object.entries(local.logs)) {
          const [pos, idx] = k.split(":").map(Number);
          const ex = exercises.find((e) => e.position === pos);
          if (!ex) continue;
          const key = keyOf(ex.id, idx);
          if (!(key in next)) {
            next[key] = {
              value: entry.value,
              missed: entry.missed,
              weightKg: entry.weightKg,
            };
          }
        }
        return next;
      });
      if (local.undoneFailures.length) {
        setUndone((prev) => {
          const seen = new Set(prev.map((u) => `${u.position}:${u.setIndex}`));
          return [
            ...prev,
            ...local.undoneFailures.filter(
              (u) => !seen.has(`${u.position}:${u.setIndex}`),
            ),
          ];
        });
      }
      if (local.rest && local.rest.deadlineEpochMs > Date.now()) {
        resume(local.rest);
      }
    })();
    return () => {
      cancelled = true;
    };
    // Mount-only: the restore reads a device-local mirror once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  /**
   * The load a set goes on. A set already logged keeps the weight it was
   * logged with; a new one takes the stepper's, else the last one the
   * athlete actually moved, else what the plan prescribes.
   */
  function weightAt(ex: ResolvedExercise, setIndex: number | null): number | null {
    const logged = setIndex == null ? null : logs[keyOf(ex.id, setIndex)];
    if (logged) return logged.weightKg;
    if (ex.id in weights) return weights[ex.id];
    for (let i = ex.sets - 1; i >= 0; i--) {
      const entry = logs[keyOf(ex.id, i)];
      if (entry) return entry.weightKg;
    }
    return ex.weightKg;
  }

  const currentWeight = weightAt(exercise, editingIndex);

  const doneForExercise = countDone(logs, exercise.id, exercise.sets);
  const totalSets = exercises.reduce((acc, e) => acc + e.sets, 0);
  const totalDone = exercises.reduce(
    (acc, e) => acc + countDone(logs, e.id, e.sets),
    0,
  );

  /** The other members of this exercise's superset, in plan order. */
  const groupMembers = useMemo(
    () =>
      exercise.supersetGroup == null
        ? [exercise]
        : exercises.filter((e) => e.supersetGroup === exercise.supersetGroup),
    [exercise, exercises],
  );

  function finish() {
    startTransition(async () => {
      const finishedAt = new Date().toISOString();
      await withLocal((s) => finishLocalSession(s, finishedAt, totalSets));
      await enqueueOp({
        kind: "session_finish",
        localSessionId: sessionId,
        finishedAt,
        notes: finishNotes.trim() || null,
      });
      const res = await flush();
      const landed = res?.results?.some(
        (r) =>
          r.localSessionId === sessionId ||
          r.canonicalSessionId === sessionId,
      );
      if (landed) {
        const canonical =
          res?.results?.find((r) => r.localSessionId === sessionId)
            ?.canonicalSessionId ?? sessionId;
        router.replace(`/sesion/${canonical}/resumen`);
        return;
      }
      // No network: the session is safe on this device and in the queue.
      setError(
        "Sin conexión. La sesión está guardada en este móvil y se subirá sola al volver la red.",
      );
    });
  }

  function advance(fromIndex: number) {
    if (fromIndex + 1 >= exercises.length) {
      // The last set never slams the door: closing the session is an
      // explicit tap, so a mis-tap cannot register a day by accident.
      setConfirmFinish(true);
      return;
    }
    setExIndex(fromIndex + 1);
    if (failureKey) setDismissedFailure(failureKey);
  }

  function record(value: number, atIndex: number | null = null) {
    // A pill tap corrects a set in place: the queue op and the server
    // upsert share the same natural key, so an overwrite flows through
    // the exact idempotent path a first write does — no rest timer, no
    // superset jump, no advancing.
    const overwrite =
      atIndex != null && Boolean(logs[keyOf(exercise.id, atIndex)]);
    const setIndex = atIndex ?? doneForExercise;
    if (setIndex >= exercise.sets) {
      advance(exIndex);
      return;
    }

    const missed = value < exercise.repMin;
    const weightKg = weightAt(exercise, atIndex);
    const k = keyOf(exercise.id, setIndex);
    const rir = pendingRir;
    const timed = exercise.effort === "seconds";
    const loggedAt = new Date().toISOString();

    // Local-first: the number lands instantly and survives a killed tab;
    // the queue takes it to the server whenever there is network.
    setLogs((prev) => ({ ...prev, [k]: { value, missed, weightKg } }));
    // What you just moved is what the next set starts from.
    if (weightKg != null) {
      setWeights((prev) => ({ ...prev, [exercise.id]: weightKg }));
    }
    setRepsOpen(false);
    setEditingIndex(null);
    setPendingRir(null);
    setError(null);

    let groupDone = false;
    let lastGroupIndex = exIndex;
    if (!overwrite) {
      // A superset runs back to back: after this member's set, jump to
      // the partner that is still behind — rest only after the last one.
      const laggard = groupMembers.find(
        (m) =>
          m.id !== exercise.id &&
          countDone(logs, m.id, m.sets) < Math.min(setIndex + 1, m.sets),
      );
      if (laggard) {
        setExIndex(exercises.findIndex((e) => e.id === laggard.id));
      } else if (autoRest) {
        start(exercise.restSeconds, `${exercise.name} · serie ${setIndex + 1}`);
      }

      // Done with the whole group (not just this row) → move past it.
      groupDone =
        !laggard &&
        groupMembers.every(
          (m) =>
            (m.id === exercise.id
              ? setIndex + 1
              : countDone(logs, m.id, m.sets)) >= m.sets,
        );
      lastGroupIndex = Math.max(
        ...groupMembers.map((m) => exercises.findIndex((e) => e.id === m.id)),
      );
    }

    startTransition(async () => {
      await withLocal((s) =>
        recordLocalSet(s, {
          position: exercise.position,
          setIndex,
          value,
          missed,
          weightKg,
          rir,
          timed,
          loggedAt,
        }),
      );
      await enqueueAndFlush({
        kind: "set_log",
        localSessionId: sessionId,
        programExerciseId: exercise.id,
        liftKey: exercise.liftKey,
        exerciseName: exercise.name,
        position: exercise.position,
        setIndex,
        reps: timed ? null : value,
        seconds: timed ? value : null,
        rir,
        weightKg,
        loggedAt,
      });
      if (groupDone) advance(lastGroupIndex);
    });
  }

  /**
   * Change the load. On a set already logged it rewrites that set in
   * place — same reps, same op key, so it flows through the idempotent
   * path a first write does; otherwise it sets what the next set uses.
   */
  function nudgeWeight(direction: 1 | -1) {
    if (currentWeight == null) return;
    const next = nextLoadableWeight(
      currentWeight,
      direction,
      exercise.equipment,
      replayCtx.config,
    );
    if (next === currentWeight) return;
    setWeights((prev) => ({ ...prev, [exercise.id]: next }));

    const setIndex = editingIndex;
    const editing = setIndex == null ? null : logs[keyOf(exercise.id, setIndex)];
    if (!editing || setIndex == null) return;

    setLogs((prev) => ({
      ...prev,
      [keyOf(exercise.id, setIndex)]: { ...editing, weightKg: next },
    }));
    const timed = exercise.effort === "seconds";
    const loggedAt = new Date().toISOString();
    startTransition(async () => {
      // Only the load changes: the RIR already stored for the set stays.
      let rir: number | null = null;
      await withLocal((s) => {
        rir = s.logs[`${exercise.position}:${setIndex}`]?.rir ?? null;
        return recordLocalSet(s, {
          position: exercise.position,
          setIndex,
          value: editing.value,
          missed: editing.missed,
          weightKg: next,
          rir,
          timed,
          loggedAt,
        });
      });
      await enqueueAndFlush({
        kind: "set_log",
        localSessionId: sessionId,
        programExerciseId: exercise.id,
        liftKey: exercise.liftKey,
        exerciseName: exercise.name,
        position: exercise.position,
        setIndex,
        reps: timed ? null : editing.value,
        seconds: timed ? editing.value : null,
        rir,
        weightKg: next,
        loggedAt,
      });
    });
  }

  function undoFailure() {
    if (!lastLiveFailure) return;
    const target = lastLiveFailure;
    setUndone((prev) => [...prev, target]);
    startTransition(async () => {
      await withLocal((s) =>
        undoLocalFailure(s, target.position, target.setIndex),
      );
      await enqueueAndFlush({
        kind: "engine_undo",
        localSessionId: sessionId,
        position: target.position,
        setIndex: target.setIndex,
      });
    });
  }

  const repOptions = useMemo(() => {
    const out: number[] = [];
    if (exercise.effort === "seconds") {
      // Holds are logged in steps of 5 seconds, well past the top.
      const top = Math.ceil((exercise.repMax + 15) / 5) * 5;
      for (let n = top; n >= 5; n -= 5) out.push(n);
      return out;
    }
    // AMRAP gets generous headroom; plain reps a little slack over the top.
    const top = exercise.effort === "amrap" ? exercise.repMax + 8 : exercise.repMax + 2;
    for (let n = top; n >= 1; n--) out.push(n);
    return out;
  }, [exercise.repMax, exercise.effort]);

  const setNumber = Math.min(doneForExercise + 1, exercise.sets);
  const eyebrow = exercise.isPrimary
    ? `Básico del día · serie ${setNumber}/${exercise.sets}`
    : exercise.supersetGroup != null
      ? `Superserie · serie ${setNumber}/${exercise.sets}`
      : `Ejercicio ${exIndex + 1} · serie ${setNumber}/${exercise.sets}`;
  const load =
    currentWeight == null || !exercise.plates
      ? null
      : currentWeight === exercise.weightKg
        ? exercise.plates
        : plateBreakdown(currentWeight, replayCtx.config);
  const plates = showPlates && load && !load.barOnly ? load : null;
  const nextExercise =
    exercises[Math.min(exIndex, exercises.length - 1) + 1] ?? null;

  return (
    <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
      <TopBar
        title={label}
        onBack={() => router.push("/")}
        right={
          <span className="num uppercase">
            {totalDone}/{totalSets} series
          </span>
        }
      />

      <div className="mt-1 flex-none px-5">
        <div className="h-[5px] rounded-full bg-line">
          <div
            className="h-full rounded-full bg-lime-line transition-[width] duration-200"
            style={{
              width: `${Math.round((totalDone / Math.max(1, totalSets)) * 100)}%`,
            }}
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-5 pt-6 pb-4">
        <div className="font-display text-[11px] leading-none font-semibold tracking-[0.14em] text-mid uppercase">
          {eyebrow}
        </div>
        <h1 className="mt-1.5 text-[20px] leading-[1.2] font-semibold">
          {exercise.name}
        </h1>

        <HeroNumber
          value={
            exercise.loadMode === "rpe" || currentWeight == null
              ? "—"
              : exercise.loadMode === "weighted_bodyweight"
                ? `+${formatWeight(currentWeight)}`
                : formatWeight(currentWeight)
          }
          unit={
            exercise.loadMode === "rpe"
              ? "sensación"
              : exercise.loadMode === "bodyweight"
                ? "corporal"
                : "kg"
          }
        />

        {/* The two numbers read mid-set, with chalk on the hands: the rep
            target and the plates per side get real rows, not hero fine print. */}
        <div className="mt-4 flex items-baseline gap-2.5">
          <span className="font-display flex-none text-[11px] leading-none font-semibold tracking-[0.14em] text-mid uppercase">
            Objetivo
          </span>
          <span className="text-[15px] leading-[1.3] font-semibold">
            <span className="num">
              {exercise.repsLabel}
              {exercise.effort === "seconds" ? "″" : ""}
            </span>
            {exercise.isPrimary ? (
              <span className="text-mid"> · RIR {targetRir}</span>
            ) : null}
            <span className="text-mid"> · desc. {exercise.restLabel}</span>
          </span>
        </div>

        {plates ? (
          <div className="mt-2 flex items-baseline gap-2.5">
            <span className="font-display flex-none text-[11px] leading-none font-semibold tracking-[0.14em] text-mid uppercase">
              Por lado
            </span>
            <span className="num text-[17px] leading-[1.2] font-semibold">
              {plates.perSide.map(formatWeight).join(" + ")}
              {plates.remainderKg ? (
                <span className="text-[13px] text-fail">
                  {" "}
                  +{formatWeight(plates.remainderKg)} sin disco
                </span>
              ) : null}
            </span>
          </div>
        ) : null}

        {/* The load is the athlete's to change: the plan prescribes, the
            bar decides. Each notch is a weight the equipment can rack. */}
        {exercise.loadMode !== "rpe" && currentWeight != null ? (
          <div className="mt-4 flex items-center gap-2.5">
            <span className="font-display flex-none text-[11px] leading-none font-semibold tracking-[0.14em] text-mid uppercase">
              {editingIndex != null && logs[keyOf(exercise.id, editingIndex)]
                ? `Peso serie ${editingIndex + 1}`
                : "Peso"}
            </span>
            <Stepper
              label="peso"
              value={weightLabelFor(exercise.loadMode, currentWeight)}
              onDecrement={() => nudgeWeight(-1)}
              onIncrement={() => nudgeWeight(1)}
            />
            {exercise.weightKg != null && currentWeight !== exercise.weightKg ? (
              <span className="num text-[12px] leading-none text-faint">
                programado {formatWeight(exercise.weightKg)}
              </span>
            ) : null}
          </div>
        ) : null}

        {/* One pill per prescribed set. A logged pill re-opens the picker
            for THAT set — a wrong value is never permanent. */}
        <div className="mt-5 flex flex-wrap gap-2.5">
          {Array.from({ length: exercise.sets }, (_, i) => {
            const entry = logs[keyOf(exercise.id, i)];
            const bad = entry?.missed ?? false;
            const editing = editingIndex === i;
            const current = !entry && i === doneForExercise;
            return (
              <button
                key={i}
                type="button"
                disabled={!entry}
                aria-label={
                  entry ? `Corregir la serie ${i + 1}` : `Serie ${i + 1}`
                }
                onClick={() => {
                  setEditingIndex(i);
                  setRepsOpen(true);
                }}
                className={cn(
                  "flex h-[60px] w-[60px] flex-col items-center justify-center gap-0.5 rounded-xl border-[1.5px]",
                  entry
                    ? bad
                      ? "border-fail bg-fail/10"
                      : "border-lime-edge bg-lime-soft"
                    : current
                      ? "border-2 border-lime-line bg-surface"
                      : "border-edge bg-surface opacity-55",
                  editing && (bad ? "border-2" : "border-2 border-lime-line"),
                )}
              >
                <span
                  className={cn(
                    "num text-[22px] leading-none font-bold",
                    entry
                      ? bad
                        ? "text-fail"
                        : "text-lime"
                      : current
                        ? "text-ink"
                        : "text-faint",
                  )}
                >
                  {entry ? entry.value : i + 1}
                </span>
                <span
                  className={cn(
                    "font-display text-[11px] leading-none font-semibold tracking-[0.1em] uppercase",
                    entry
                      ? bad
                        ? "text-fail"
                        : "text-lime"
                      : current
                        ? "text-mid"
                        : "text-faint",
                  )}
                >
                  {entry ? "hecha" : current ? "ahora" : "queda"}
                </span>
              </button>
            );
          })}
        </div>

        {rest ? (
          <div className="mt-5">
            <RestBar rest={rest} onSkip={stop} onExtend={() => extend(30)} />
          </div>
        ) : null}

        {nextExercise ? (
          <div className="mt-4.5 flex items-center gap-2.5 px-1">
            <span className="font-display flex-none text-[11px] leading-none font-semibold tracking-[0.12em] text-faint uppercase">
              Siguiente
            </span>
            <span className="flex-1 truncate text-[14px] leading-[1.2] font-medium">
              {nextExercise.name}
            </span>
            <span className="num flex-none text-[13.5px] leading-none font-semibold text-mid">
              {nextExercise.schemeLabel} ·{" "}
              {weightLabelFor(nextExercise.loadMode, weightAt(nextExercise, null))}
            </span>
          </div>
        ) : null}

        {error ? (
          <Card className="mt-4 border-fail px-4 py-3.5 text-[12.5px] leading-[1.5]">
            {error}
          </Card>
        ) : null}

        {banner ? (
          <Callout
            className="mt-4"
            eyebrow={banner.title}
            eyebrowTone={
              banner.tone === "warn" ? "text-warn-panel" : "text-fail-panel"
            }
            action={
              lastLiveFailure ? (
                <button
                  type="button"
                  onClick={undoFailure}
                  className="text-[11.5px] leading-none font-medium underline opacity-70"
                >
                  deshacer
                </button>
              ) : null
            }
          >
            {banner.detail}
          </Callout>
        ) : null}

        {repsOpen ? (
          <Card className="mt-4 px-4 py-4">
            <div className="font-display text-[11px] leading-none font-semibold tracking-[0.14em] text-mid uppercase">
              {editingIndex != null
                ? `Corregir serie ${editingIndex + 1}`
                : exercise.effort === "seconds"
                  ? "Segundos aguantados"
                  : exercise.effort === "amrap"
                    ? "Reps completadas · AMRAP"
                    : "Reps completadas"}
            </div>
            <div className="mt-3 flex items-center gap-2">
              <span className="font-display text-[11px] leading-none font-semibold tracking-[0.14em] text-mid uppercase">
                RIR
              </span>
              {[0, 1, 2, 3, 4].map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setPendingRir((v) => (v === n ? null : n))}
                  className={cn(
                    "num flex h-11 w-11 items-center justify-center rounded-md border text-[15px] leading-none font-bold",
                    pendingRir === n
                      ? "border-transparent bg-strength text-on-strength"
                      : "border-edge bg-soft text-mid",
                  )}
                >
                  {n}
                </button>
              ))}
              <span className="text-[11px] leading-none text-faint">
                opcional
              </span>
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {repOptions.map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => record(n, editingIndex)}
                  className={cn(
                    "num flex h-11 w-11 items-center justify-center rounded-md border text-[17px] leading-none font-bold",
                    n < exercise.repMin
                      ? "border-fail bg-surface text-fail"
                      : "border-edge bg-soft text-ink",
                  )}
                >
                  {n}
                </button>
              ))}
            </div>
            <p className="mt-3 text-[12px] leading-[1.5] text-faint">
              Por debajo de {exercise.repMin}{" "}
              {exercise.isPrimary
                ? "el motor reacciona: primero congela el peso, luego recorta la RM."
                : "no pasa nada: los accesorios no tocan el motor."}
            </p>
          </Card>
        ) : null}

        {exercise.notes ? (
          <p className="mt-4 text-[12.5px] leading-[1.5] text-mid">
            {exercise.notes}
          </p>
        ) : null}

        <div className="font-display mt-6 text-[11px] leading-none font-semibold tracking-[0.12em] text-faint uppercase">
          Después
        </div>
        <div className="mt-2.5 flex flex-col gap-1.5">
          {exercises.map((e, i) => {
            const done = countDone(logs, e.id, e.sets);
            const complete = done >= e.sets;
            return (
              <SessionRow
                key={e.id}
                accent={
                  complete || i === exIndex ? TONE.okBright : TONE.hairline
                }
                title={e.name}
                status={complete ? "✓ HECHA" : i === exIndex ? "AHORA" : undefined}
                statusTone={complete ? "text-ok" : "text-lime"}
                primary={weightLabelFor(e.loadMode, weightAt(e, null))}
                secondary={`${done}/${e.sets}`}
                muted={complete}
                onClick={() => {
                  setExIndex(i);
                  if (failureKey) setDismissedFailure(failureKey);
                  setRepsOpen(false);
                  setEditingIndex(null);
                }}
              />
            );
          })}
        </div>

        {/* Explicit exit: the gym closes, the shoulder hurts — a session
            can close as partial without inventing sets. A complete one
            confirms too: the last set never registers the day by itself. */}
        {confirmFinish ? (
          <div ref={finishRef}>
            <Card
              className={cn(
                "mt-4 px-4 py-4",
                totalDone < totalSets ? "border-fail" : "border-lime-edge",
              )}
            >
              <div className="flex items-center gap-2.5">
                <span className="flex-1 text-[12.5px] leading-[1.4] font-semibold">
                  {totalDone < totalSets ? (
                    <>
                      ¿Terminar con {totalSets - totalDone}{" "}
                      {totalSets - totalDone === 1 ? "serie" : "series"} sin
                      hacer?
                    </>
                  ) : (
                    <>Sesión completa. ¿Terminar y registrar?</>
                  )}
                </span>
                <button
                  type="button"
                  disabled={pending}
                  onClick={finish}
                  className="font-display flex h-11 items-center rounded-md bg-strength px-3.5 text-[11.5px] leading-none font-bold tracking-[0.06em] text-on-strength uppercase disabled:opacity-40"
                >
                  {totalDone < totalSets ? "Sí, terminar" : "Terminar"}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmFinish(false)}
                  className="text-[12px] leading-none font-medium text-mid underline"
                >
                  seguir
                </button>
              </div>
              <textarea
                value={finishNotes}
                onChange={(e) => setFinishNotes(e.target.value)}
                rows={2}
                maxLength={2000}
                placeholder={
                  totalDone < totalSets
                    ? "Por qué cierras antes — «aquíleo molesto», «sin tiempo»… (opcional)"
                    : "Nota de la sesión — «última serie dura», «buenas sensaciones»… (opcional)"
                }
                aria-label="Nota de la sesión"
                className="mt-3 w-full rounded-md border border-edge bg-soft px-3 py-2.5 text-[12.5px] leading-[1.45] outline-none"
              />
            </Card>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmFinish(true)}
            className="mt-4 flex w-full items-center justify-between rounded-xl border border-dashed border-hairline px-4 py-3.5 text-left"
          >
            <span className="font-display text-[12px] leading-none font-semibold tracking-[0.06em] uppercase">
              Terminar sesión
            </span>
            <span className="num text-[12px] leading-none text-mid">
              {totalDone}/{totalSets} series
            </span>
          </button>
        )}
      </div>

      {/* AppShell already pays `--safe-bottom` on the runner branch. */}
      <div className="flex flex-none gap-2.5 px-5 pt-3.5 pb-[30px]">
        <button
          type="button"
          disabled={pending}
          onClick={() => {
            if (exercise.effort === "amrap") {
              setEditingIndex(null);
              setRepsOpen(true);
              return;
            }
            record(exercise.repMax);
          }}
          className="font-display flex h-[68px] flex-1 items-center justify-center gap-2.5 rounded-2xl bg-strength text-[18px] leading-none font-bold tracking-[0.04em] text-on-strength uppercase active:opacity-85 disabled:opacity-40"
        >
          {exercise.effort === "amrap" ? (
            "Registrar AMRAP"
          ) : (
            <>
              Hecho ·
              <span className="num">
                {exercise.repMax}
                {exercise.effort === "seconds" ? "″" : ""}
              </span>
            </>
          )}
        </button>
        <button
          type="button"
          onClick={() => {
            // Always a FRESH set from here — a pill left in edit mode
            // must not make this overwrite an old value.
            setEditingIndex(null);
            setRepsOpen((v) => !v);
          }}
          className="font-display flex h-[68px] w-[104px] items-center justify-center rounded-2xl border-[1.5px] border-edge bg-surface text-[13px] leading-none font-semibold tracking-[0.06em] text-mid uppercase"
        >
          Otras
        </button>
      </div>

      {flash ? (
        <div
          aria-hidden
          className="animate-flash pointer-events-none absolute inset-0 z-10"
          style={{ background: TONE.okBright }}
        />
      ) : null}
    </div>
  );
}

function countDone(logs: LogMap, exerciseId: string, sets: number): number {
  let n = 0;
  for (let i = 0; i < sets; i++) if (logs[keyOf(exerciseId, i)]) n++;
  return n;
}
