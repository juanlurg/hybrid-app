"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";

import { PlateChips } from "@/components/ui/kit";
import { RestBar, useRestTimer, useWakeLock } from "@/components/session/rest-timer";
import { formatWeight } from "@/lib/engine";
import type { ResolvedExercise } from "@/lib/domain/plan";
import {
  finishSession,
  logSet,
  undoEngineEvent,
  type EngineBanner,
} from "@/lib/actions/session";
import { cn } from "@/lib/cn";

interface LoggedSet {
  programExerciseId: string | null;
  setIndex: number;
  reps: number | null;
  missedRange: boolean;
}

type LogMap = Record<string, { reps: number; missed: boolean }>;

const keyOf = (exerciseId: string, setIndex: number) =>
  `${exerciseId}:${setIndex}`;

export function SessionRunner({
  sessionId,
  label,
  exercises,
  initialLogs,
  autoRest,
  sound,
  vibration,
  keepAwake,
  showPlates,
  targetRir,
}: {
  sessionId: string;
  label: string;
  exercises: ResolvedExercise[];
  initialLogs: LoggedSet[];
  autoRest: boolean;
  sound: boolean;
  vibration: boolean;
  keepAwake: boolean;
  showPlates: boolean;
  targetRir: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [banner, setBanner] = useState<EngineBanner | null>(null);
  const [repsOpen, setRepsOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [logs, setLogs] = useState<LogMap>(() => {
    const map: LogMap = {};
    for (const l of initialLogs) {
      if (!l.programExerciseId || l.reps == null) continue;
      map[keyOf(l.programExerciseId, l.setIndex)] = {
        reps: l.reps,
        missed: l.missedRange,
      };
    }
    return map;
  });

  const firstUnfinished = useMemo(() => {
    const idx = exercises.findIndex((ex) => {
      const done = countDone(logs, ex.id, ex.sets);
      return done < ex.sets;
    });
    return idx === -1 ? exercises.length - 1 : idx;
  }, [exercises, logs]);

  const [exIndex, setExIndex] = useState(firstUnfinished);
  const exercise = exercises[Math.min(exIndex, exercises.length - 1)];

  const { rest, flash, start, stop, extend } = useRestTimer({ sound, vibration });
  useWakeLock(keepAwake);

  const doneForExercise = countDone(logs, exercise.id, exercise.sets);
  const totalSets = exercises.reduce((acc, e) => acc + e.sets, 0);
  const totalDone = exercises.reduce(
    (acc, e) => acc + countDone(logs, e.id, e.sets),
    0,
  );

  function advance(fromIndex: number) {
    if (fromIndex + 1 >= exercises.length) {
      startTransition(async () => {
        await finishSession(sessionId);
        router.replace(`/sesion/${sessionId}/resumen`);
      });
      return;
    }
    setExIndex(fromIndex + 1);
    setBanner(null);
  }

  function record(reps: number) {
    const setIndex = doneForExercise;
    if (setIndex >= exercise.sets) {
      advance(exIndex);
      return;
    }

    const missed = reps < exercise.repMin;
    const k = keyOf(exercise.id, setIndex);

    // Optimistic: the athlete is mid-set, the number has to land instantly.
    setLogs((prev) => ({ ...prev, [k]: { reps, missed } }));
    setRepsOpen(false);
    setError(null);
    if (autoRest) {
      start(exercise.restSeconds, `${exercise.name} · serie ${setIndex + 1}`);
    }

    const wasLast = setIndex + 1 >= exercise.sets;
    const currentIndex = exIndex;

    startTransition(async () => {
      const res = await logSet({
        sessionId,
        programExerciseId: exercise.id,
        position: exercise.position,
        setIndex,
        reps,
        weightKg: exercise.weightKg,
      });
      if (!res.ok) {
        setLogs((prev) => {
          const next = { ...prev };
          delete next[k];
          return next;
        });
        setError(res.error ?? "No se ha podido guardar la serie.");
        return;
      }
      if (res.banner) setBanner(res.banner);
      if (wasLast) advance(currentIndex);
    });
  }

  const repOptions = useMemo(() => {
    const out: number[] = [];
    for (let n = exercise.repMax + 2; n >= 1; n--) out.push(n);
    return out;
  }, [exercise.repMax]);

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
                {entry ? entry.reps : i + 1}
              </span>
              <span
                className={cn(
                  "text-[8.5px] leading-none font-semibold tracking-[0.12em] uppercase",
                  entry ? (bad ? "text-fail" : "text-ok") : "text-ghost",
                )}
              >
                {entry ? "reps" : "serie"}
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
              {banner.eventId ? (
                <button
                  type="button"
                  onClick={() =>
                    startTransition(async () => {
                      await undoEngineEvent(banner.eventId);
                      setBanner(null);
                      router.refresh();
                    })
                  }
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
              Reps completadas
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
                  setBanner(null);
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
          onClick={() => record(exercise.repMax)}
          className="flex h-[66px] flex-1 items-center justify-center gap-2.5 bg-strength text-[17px] leading-none font-extrabold tracking-[0.06em] text-ink uppercase active:opacity-85 disabled:opacity-60"
        >
          Hecho <span className="num opacity-60">{exercise.repMax}</span>
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
