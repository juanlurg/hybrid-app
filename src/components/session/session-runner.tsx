"use client";

import { useRouter } from "next/navigation";
import { useMemo, useRef, useState, useTransition } from "react";

import { PlateChips } from "@/components/ui/kit";
import { RestBar, useRestTimer, useWakeLock } from "@/components/session/rest-timer";
import { formatWeight, type EngineConfig, type LiftState } from "@/lib/engine";
import { replayEngine, type ReplayPrimary } from "@/lib/engine/replay";
import type { ResolvedExercise } from "@/lib/domain/plan";
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
  missedRange: boolean;
}

/** What the client needs to run the regression engine locally. */
export interface ReplayContext {
  lift: LiftState | null;
  primary: ReplayPrimary | null;
  week: number;
  config: EngineConfig;
}

/** `value` is reps or seconds, whichever the exercise's effort counts. */
type LogMap = Record<string, { value: number; missed: boolean }>;

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
  const [error, setError] = useState<string | null>(null);

  const [logs, setLogs] = useState<LogMap>(() => {
    const map: LogMap = {};
    for (const l of initialLogs) {
      const value = l.reps ?? l.seconds;
      if (!l.programExerciseId || value == null) continue;
      map[keyOf(l.programExerciseId, l.setIndex)] = {
        value,
        missed: l.missedRange,
      };
    }
    return map;
  });

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
        weightKg: primaryExercise.weightKg,
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

  const { rest, flash, start, stop, extend } = useRestTimer({ sound, vibration });
  useWakeLock(keepAwake);

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
      finish();
      return;
    }
    setExIndex(fromIndex + 1);
    if (failureKey) setDismissedFailure(failureKey);
  }

  function record(value: number) {
    const setIndex = doneForExercise;
    if (setIndex >= exercise.sets) {
      advance(exIndex);
      return;
    }

    const missed = value < exercise.repMin;
    const k = keyOf(exercise.id, setIndex);
    const rir = pendingRir;
    const timed = exercise.effort === "seconds";
    const loggedAt = new Date().toISOString();

    // Local-first: the number lands instantly and survives a killed tab;
    // the queue takes it to the server whenever there is network.
    setLogs((prev) => ({ ...prev, [k]: { value, missed } }));
    setRepsOpen(false);
    setPendingRir(null);
    setError(null);

    // A superset runs back to back: after this member's set, jump to the
    // partner that is still behind — rest only after the last one.
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
    const groupDone =
      !laggard &&
      groupMembers.every(
        (m) =>
          (m.id === exercise.id
            ? setIndex + 1
            : countDone(logs, m.id, m.sets)) >= m.sets,
      );
    const lastGroupIndex = Math.max(
      ...groupMembers.map((m) => exercises.findIndex((e) => e.id === m.id)),
    );

    startTransition(async () => {
      await withLocal((s) =>
        recordLocalSet(s, {
          position: exercise.position,
          setIndex,
          value,
          missed,
          weightKg: exercise.weightKg,
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
        weightKg: exercise.weightKg,
        loggedAt,
      });
      if (groupDone) advance(lastGroupIndex);
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

  return (
    <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex flex-none items-center gap-3 bg-ink px-4 py-3 text-paper">
        <button
          type="button"
          aria-label="Volver"
          onClick={() => router.push("/")}
          className="text-[17px] leading-none font-medium"
        >
          ←
        </button>
        <span className="flex-1 text-[11px] leading-none font-extrabold tracking-[0.1em] uppercase">
          {label}
        </span>
        <span className="num text-[11px] leading-none font-medium opacity-60">
          {exIndex + 1} / {exercises.length} · {totalDone}/{totalSets} series
        </span>
      </div>

      <div className="h-1 flex-none bg-ink-2">
        <div
          className="h-full bg-strength transition-[width] duration-200"
          style={{ width: `${Math.round((totalDone / Math.max(1, totalSets)) * 100)}%` }}
        />
      </div>

      <section className="flex-none bg-strength px-4 pt-4 pb-3.5 text-ink">
        <div className="text-[11px] leading-none font-extrabold tracking-[0.14em] uppercase">
          {exercise.isPrimary
            ? `Básico del día · serie ${Math.min(doneForExercise + 1, exercise.sets)}`
            : exercise.supersetGroup != null
              ? `Superserie · serie ${Math.min(doneForExercise + 1, exercise.sets)}`
              : `Ejercicio ${exIndex + 1} · serie ${Math.min(doneForExercise + 1, exercise.sets)}`}
        </div>
        <h1 className="mt-1.5 text-[21px] leading-[1.05] font-bold">
          {exercise.name}
        </h1>
        <div className="mt-2.5 flex items-start gap-2.5">
          <div className="num text-[86px] leading-[0.76] font-black tracking-[-0.055em] sm:text-[104px]">
            {exercise.loadMode === "rpe" || exercise.weightKg == null
              ? "—"
              : exercise.loadMode === "weighted_bodyweight"
                ? `+${formatWeight(exercise.weightKg)}`
                : formatWeight(exercise.weightKg)}
          </div>
          <div className="pt-2">
            <div className="text-[19px] leading-none font-extrabold uppercase">
              {exercise.loadMode === "rpe"
                ? "sensación"
                : exercise.loadMode === "bodyweight"
                  ? "corporal"
                  : "kg"}
            </div>
            <div className="mt-2 text-[12px] leading-[1.3] font-semibold opacity-75">
              {exercise.schemeLabel}
              {exercise.isPrimary ? ` · RIR ${targetRir}` : ""}
              <br />
              DESC. {exercise.restLabel}
            </div>
          </div>
        </div>
        {showPlates && exercise.plates && !exercise.plates.barOnly ? (
          <div className="mt-2.5 flex items-center gap-1.5">
            <span className="text-[10px] leading-none font-semibold tracking-[0.1em] opacity-70 uppercase">
              Por lado
            </span>
            <PlateChips
              plates={exercise.plates.perSide}
              remainder={exercise.plates.remainderKg}
            />
          </div>
        ) : null}
      </section>

      {/* One pill per prescribed set. */}
      <div className="flex flex-none gap-0.5 bg-line py-0.5">
        {Array.from({ length: exercise.sets }, (_, i) => {
          const entry = logs[keyOf(exercise.id, i)];
          const bad = entry?.missed ?? false;
          return (
            <div
              key={i}
              className={cn(
                "flex h-[62px] flex-1 flex-col items-center justify-center gap-1 border-2 box-border",
                entry
                  ? bad
                    ? "border-fail bg-fail/10"
                    : "border-ok bg-ok/10"
                  : "border-quiet bg-paper",
              )}
            >
              <span
                className={cn(
                  "num text-[24px] leading-none font-black",
                  entry ? (bad ? "text-fail" : "text-ok") : "text-hairline",
                )}
              >
                {entry ? entry.value : i + 1}
              </span>
              <span
                className={cn(
                  "text-[8.5px] leading-none font-semibold tracking-[0.12em] uppercase",
                  entry ? (bad ? "text-fail" : "text-ok") : "text-ghost",
                )}
              >
                {entry
                  ? exercise.effort === "seconds"
                    ? "seg"
                    : "reps"
                  : "serie"}
              </span>
            </div>
          );
        })}
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-4 pt-3.5 pb-4">
        {exercise.notes ? (
          <p className="text-[11.5px] leading-[1.45] text-mid">
            {exercise.notes}
          </p>
        ) : null}

        {error ? (
          <div className="mt-3 border-l-[6px] border-fail py-1 pl-3 text-[12px] leading-[1.5]">
            {error}
          </div>
        ) : null}

        {banner ? (
          <div className="mt-3 bg-ink px-3.5 py-3.5 text-paper">
            <div className="flex items-baseline gap-2">
              <span
                className={cn(
                  "text-[10px] leading-none font-extrabold tracking-[0.12em] uppercase",
                  banner.tone === "warn" ? "text-warn" : "text-fail",
                )}
              >
                {banner.title}
              </span>
              {lastLiveFailure ? (
                <button
                  type="button"
                  onClick={undoFailure}
                  className="ml-auto text-[10.5px] leading-none font-medium underline opacity-60"
                >
                  deshacer
                </button>
              ) : null}
            </div>
            <p className="mt-2 text-[12px] leading-[1.5] opacity-80">
              {banner.detail}
            </p>
          </div>
        ) : null}

        {repsOpen ? (
          <div className="mt-3.5">
            <div className="text-[10px] leading-none font-extrabold tracking-[0.14em] text-mid uppercase">
              {exercise.effort === "seconds"
                ? "Segundos aguantados"
                : exercise.effort === "amrap"
                  ? "Reps completadas · AMRAP"
                  : "Reps completadas"}
            </div>
            <div className="mt-2.5 flex items-center gap-2">
              <span className="text-[10px] leading-none font-extrabold tracking-[0.14em] text-mid uppercase">
                RIR
              </span>
              {[0, 1, 2, 3, 4].map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setPendingRir((v) => (v === n ? null : n))}
                  className={cn(
                    "num flex h-8 w-8 items-center justify-center border-2 text-[13px] leading-none font-extrabold",
                    pendingRir === n
                      ? "border-ink bg-ink text-paper"
                      : "border-hairline text-mid",
                  )}
                >
                  {n}
                </button>
              ))}
              <span className="text-[10px] leading-none text-faint">
                opcional
              </span>
            </div>
            <div className="mt-2.5 flex flex-wrap gap-0.5">
              {repOptions.map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => record(n)}
                  className={cn(
                    "num flex h-11 w-11 items-center justify-center border-2 text-[17px] leading-none font-extrabold",
                    n < exercise.repMin
                      ? "border-fail text-fail"
                      : "border-ink text-ink",
                  )}
                >
                  {n}
                </button>
              ))}
            </div>
            <p className="mt-2.5 text-[11px] leading-[1.45] text-faint">
              Por debajo de {exercise.repMin}{" "}
              {exercise.isPrimary
                ? "el motor reacciona: primero congela el peso, luego recorta la RM."
                : "no pasa nada: los accesorios no tocan el motor."}
            </p>
          </div>
        ) : null}

        <div className="mt-5 text-[10px] leading-none font-extrabold tracking-[0.14em] text-mid uppercase">
          Después
        </div>
        <div className="mt-2.5 flex flex-col gap-px bg-line">
          {exercises.map((e, i) => {
            const done = countDone(logs, e.id, e.sets);
            const complete = done >= e.sets;
            return (
              <button
                key={e.id}
                type="button"
                onClick={() => {
                  setExIndex(i);
                  if (failureKey) setDismissedFailure(failureKey);
                  setRepsOpen(false);
                }}
                className="flex items-center gap-2.5 bg-paper py-2.5 text-left"
              >
                <span
                  className={cn(
                    "w-3.5 text-[11px] leading-none font-extrabold",
                    complete
                      ? "text-ok"
                      : i === exIndex
                        ? "text-ink"
                        : "text-quiet",
                  )}
                >
                  {complete ? "✓" : i === exIndex ? "▸" : "·"}
                </span>
                <span
                  className={cn(
                    "flex-1 text-[13px] leading-[1.2] font-semibold",
                    complete && "text-mid",
                  )}
                >
                  {e.name}
                </span>
                <span className="num text-[11px] leading-none font-medium text-mid">
                  {done}/{e.sets}
                </span>
                <span className="num min-w-[62px] text-right text-[12.5px] leading-none font-extrabold">
                  {e.weightLabel}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex flex-none">
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            exercise.effort === "amrap"
              ? setRepsOpen(true)
              : record(exercise.repMax)
          }
          className="flex h-[66px] flex-1 items-center justify-center gap-2.5 bg-strength text-[17px] leading-none font-extrabold tracking-[0.06em] text-ink uppercase active:opacity-85 disabled:opacity-60"
        >
          {exercise.effort === "amrap" ? (
            "Registrar AMRAP"
          ) : (
            <>
              Hecho{" "}
              <span className="num opacity-60">
                {exercise.repMax}
                {exercise.effort === "seconds" ? "″" : ""}
              </span>
            </>
          )}
        </button>
        <button
          type="button"
          onClick={() => setRepsOpen((v) => !v)}
          className="flex h-[66px] w-[92px] flex-col items-center justify-center gap-1 bg-ink text-[11px] leading-none font-semibold text-paper"
        >
          <span>OTRAS</span>
          <span className="opacity-60">REPS</span>
        </button>
      </div>

      {rest ? (
        <RestBar rest={rest} onSkip={stop} onExtend={() => extend(30)} />
      ) : null}

      {flash ? (
        <div
          aria-hidden
          className="animate-flash pointer-events-none absolute inset-0 z-10"
          style={{ background: "oklch(0.72 0.19 130)" }}
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
