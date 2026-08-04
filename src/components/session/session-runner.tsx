"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";

import { PlateChips } from "@/components/ui/kit";
import { TONE } from "@/components/day-accents";
import {
  RestBar,
  RestOverdue,
  useRestTimer,
  useWakeLock,
} from "@/components/session/rest-timer";
import {
  formatWeight,
  warmupSets,
  type EngineConfig,
  type LiftState,
} from "@/lib/engine";
import { replayEngine, type ReplayPrimary } from "@/lib/engine/replay";
import type { ResolvedExercise } from "@/lib/domain/plan";
import { storageHealthy } from "@/lib/offline/db";
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

/** A catalogue row that substitutes a planned exercise ("me molesta"). */
export interface SubstituteOption {
  slug: string;
  name: string;
  cue: string | null;
  equipment: string | null;
}

/** Substitute options per program exercise id. */
export type SubstitutesMap = Record<string, SubstituteOption[]>;

/** The chosen swap. The weight is athlete input, never an engine number. */
interface LocalSubstitution {
  slug: string;
  name: string;
  weightKg: number | null;
}

/**
 * Runner-owned extra that rides along inside the persisted local
 * session: which swap is active per exercise (the per-set flag lives on
 * each `LocalSetEntry.substituted`). An optional field the offline
 * reducers spread through untouched, so old records stay valid.
 */
type RunnerLocalState = LocalSessionState & {
  /** By exercise position — same keying as `logs`. */
  substitutions?: Record<string, LocalSubstitution>;
};

const keyOf = (exerciseId: string, setIndex: number) =>
  `${exerciseId}:${setIndex}`;

/** Pre-lift glute activation — local ticks only, never logged. */
const ACTIVATION_ITEMS = ["clamshells", "monster walk", "puente de glúteo"];

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
  substitutes = {},
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
  /** Absent offline — the swap chosen online still restores by name. */
  substitutes?: SubstitutesMap;
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
  /* "me molesta": chosen swap per program exercise id, plus which set
     ops were logged under one — those never move the engine. */
  const [subs, setSubs] = useState<Record<string, LocalSubstitution>>({});
  const [substitutedSets, setSubstitutedSets] = useState<Set<string>>(
    () => new Set(),
  );
  const [subPickerOpen, setSubPickerOpen] = useState(false);
  /* Pre-session block: collapsed by default, ticks are local only. */
  const [warmupOpen, setWarmupOpen] = useState(false);
  const [activationDone, setActivationDone] = useState<boolean[]>(() =>
    ACTIVATION_ITEMS.map(() => false),
  );

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
  const localRef = useRef<RunnerLocalState | null>(null);
  async function withLocal(
    mutate: (s: RunnerLocalState) => RunnerLocalState,
  ): Promise<void> {
    let s: RunnerLocalState =
      localRef.current ??
      ((await getLocalSession(sessionId)) as RunnerLocalState | undefined) ??
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
      // Sets logged under a substitution never move the engine — the
      // server skips them too (queue op `substituted`).
      if (substitutedSets.has(`${primaryExercise.position}:${i}`)) continue;
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
  }, [exercises, logs, undone, substitutedSets, replayCtx, sessionId]);

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

  const { rest, flash, overdue, start, stop, extend, resume } = useRestTimer({
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
      const local = (await getLocalSession(sessionId)) as
        | RunnerLocalState
        | undefined;
      if (!local || cancelled) return;
      localRef.current = local;
      setLogs((prev) => {
        const next = { ...prev };
        for (const [k, entry] of Object.entries(local.logs)) {
          const [pos, idx] = k.split(":").map(Number);
          const ex = exercises.find((e) => e.position === pos);
          if (!ex) continue;
          const key = keyOf(ex.id, idx);
          if (!(key in next)) next[key] = { value: entry.value, missed: entry.missed };
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
      // A reload keeps the chosen swaps — names travel in the entry, so
      // this works offline where the catalogue is out of reach.
      if (local.substitutions) {
        const restored: Record<string, LocalSubstitution> = {};
        for (const [pos, entry] of Object.entries(local.substitutions)) {
          const ex = exercises.find((e) => e.position === Number(pos));
          if (ex) restored[ex.id] = entry;
        }
        if (Object.keys(restored).length) {
          setSubs((prev) => ({ ...restored, ...prev }));
        }
      }
      // Which sets were logged under a swap lives on each entry.
      const flagged = Object.entries(local.logs)
        .filter(([, entry]) => entry.substituted)
        .map(([k]) => k);
      if (flagged.length) {
        setSubstitutedSets((prev) => new Set([...prev, ...flagged]));
      }
      // An expired deadline still reaches resume(): it shows the brief
      // "descanso terminado hace n s" notice instead of vanishing.
      if (local.rest) {
        resume(local.rest);
      }
    })();
    return () => {
      cancelled = true;
    };
    // Mount-only: the restore reads a device-local mirror once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

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

  const primary = useMemo(
    () => exercises.find((e) => e.isPrimary) ?? null,
    [exercises],
  );
  /* The approach ramp comes from the engine — never computed here. */
  const warmup = useMemo(
    () =>
      primary?.weightKg != null
        ? warmupSets(primary.weightKg, replayCtx.config)
        : [],
    [primary, replayCtx.config],
  );

  const sub = subs[exercise.id] ?? null;
  const subOptions = substitutes[exercise.id] ?? [];
  const primarySub = primary ? (subs[primary.id] ?? null) : null;
  const sessionComplete = totalSets > 0 && totalDone >= totalSets;

  function chooseSub(option: SubstituteOption) {
    const entry: LocalSubstitution = {
      slug: option.slug,
      name: option.name,
      weightKg: exercise.weightKg,
    };
    setSubs((prev) => ({ ...prev, [exercise.id]: entry }));
    setSubPickerOpen(false);
    startTransition(async () => {
      await withLocal((s) => ({
        ...s,
        substitutions: {
          ...(s.substitutions ?? {}),
          [String(exercise.position)]: entry,
        },
      }));
    });
  }

  function clearSub() {
    setSubs((prev) => {
      const next = { ...prev };
      delete next[exercise.id];
      return next;
    });
    setSubPickerOpen(false);
    startTransition(async () => {
      await withLocal((s) => {
        const next = { ...(s.substitutions ?? {}) };
        delete next[String(exercise.position)];
        return { ...s, substitutions: next };
      });
    });
  }

  /** Athlete input for the swap's load — not an engine number. */
  function bumpSubWeight(deltaKg: number) {
    const current = subs[exercise.id];
    if (!current) return;
    const entry: LocalSubstitution = {
      ...current,
      weightKg: Math.max(
        0,
        Math.round(((current.weightKg ?? 0) + deltaKg) * 100) / 100,
      ),
    };
    setSubs((prev) => ({ ...prev, [exercise.id]: entry }));
    startTransition(async () => {
      await withLocal((s) => ({
        ...s,
        substitutions: {
          ...(s.substitutions ?? {}),
          [String(exercise.position)]: entry,
        },
      }));
    });
  }

  function finish() {
    startTransition(async () => {
      const finishedAt = new Date().toISOString();
      // Substitutions document themselves in the session note.
      const subNotes = exercises
        .filter((e) => subs[e.id])
        .map((e) => `${e.name} sustituida por ${subs[e.id].name} (molestia)`);
      const notes =
        [finishNotes.trim(), ...subNotes].filter(Boolean).join("\n") || null;
      await withLocal((s) => finishLocalSession(s, finishedAt, totalSets));
      await enqueueOp({
        kind: "session_finish",
        localSessionId: sessionId,
        finishedAt,
        notes,
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
      // No network: only claim device persistence when IndexedDB still
      // holds the ops — after a storage failure they live in tab memory.
      setError(
        storageHealthy()
          ? "Sin conexión. La sesión está guardada en este móvil y se subirá sola al volver la red."
          : "Sin conexión. Este navegador no puede guardar en el dispositivo: no cierres esta pestaña hasta que vuelva la conexión.",
      );
    });
  }

  function advance(fromIndex: number) {
    if (failureKey) setDismissedFailure(failureKey);
    if (fromIndex + 1 >= exercises.length) {
      // The last set no longer slams the door: no auto-finish, no
      // navigation. The runner falls into the "sesión completa" state
      // below — pills stay editable, a note can be written — and only
      // the explicit bar commits finish(). If something earlier is
      // still unfinished, jump there instead.
      const idx = exercises.findIndex(
        (ex) =>
          !groupMembers.some((m) => m.id === ex.id) &&
          countDone(logs, ex.id, ex.sets) < ex.sets,
      );
      if (idx !== -1) setExIndex(idx);
      return;
    }
    setExIndex(fromIndex + 1);
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

    // The failure floor, not repMin: on the 85 % wave week the engine
    // tolerates one rep less before it reacts.
    const missed = value < exercise.repFloor;
    const k = keyOf(exercise.id, setIndex);
    const rir = pendingRir;
    const timed = exercise.effort === "seconds";
    const loggedAt = new Date().toISOString();
    const substituted = sub != null;
    const weightKg = substituted ? sub.weightKg : exercise.weightKg;
    const flagKey = `${exercise.position}:${setIndex}`;

    // Local-first: the number lands instantly and survives a killed tab;
    // the queue takes it to the server whenever there is network.
    setLogs((prev) => ({ ...prev, [k]: { value, missed } }));
    setSubstitutedSets((prev) => {
      if (substituted === prev.has(flagKey)) return prev;
      const next = new Set(prev);
      if (substituted) next.add(flagKey);
      else next.delete(flagKey);
      return next;
    });
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
          substituted,
          loggedAt,
        }),
      );
      await enqueueAndFlush({
        kind: "set_log",
        localSessionId: sessionId,
        programExerciseId: exercise.id,
        liftKey: exercise.liftKey,
        exerciseName: substituted ? sub.name : exercise.name,
        position: exercise.position,
        setIndex,
        reps: timed ? null : value,
        seconds: timed ? value : null,
        rir,
        weightKg,
        loggedAt,
        // A substituted set is history, never engine input.
        substituted,
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
        {sub ? (
          <div className="mt-2 inline-flex items-center bg-ink px-2 py-1.5 text-[10px] leading-none font-extrabold tracking-[0.1em] text-warn uppercase">
            sustituida → {sub.name}
          </div>
        ) : null}
        <div className="mt-2.5 flex items-start gap-2.5">
          <div className="num text-[86px] leading-[0.76] font-black tracking-[-0.055em] sm:text-[104px]">
            {exercise.loadMode === "rpe" ||
            (sub ? sub.weightKg : exercise.weightKg) == null
              ? "—"
              : exercise.loadMode === "weighted_bodyweight"
                ? `+${formatWeight((sub ? sub.weightKg : exercise.weightKg)!)}`
                : formatWeight((sub ? sub.weightKg : exercise.weightKg)!)}
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
        {/* Plates describe the planned bar — meaningless once swapped. */}
        {showPlates && !sub && exercise.plates && !exercise.plates.barOnly ? (
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
        {subOptions.length > 0 || sub ? (
          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setSubPickerOpen((v) => !v);
                setRepsOpen(false);
                setEditingIndex(null);
              }}
              className="flex h-10 items-center border-2 border-ink px-3 text-[11px] leading-none font-extrabold tracking-[0.06em] uppercase"
            >
              me molesta
            </button>
            {sub && sub.weightKg != null ? (
              <>
                <button
                  type="button"
                  aria-label="Menos peso"
                  onClick={() => bumpSubWeight(-replayCtx.config.roundingKg)}
                  className="num flex h-10 w-10 items-center justify-center border-2 border-ink text-[17px] leading-none font-extrabold"
                >
                  −
                </button>
                <button
                  type="button"
                  aria-label="Más peso"
                  onClick={() => bumpSubWeight(replayCtx.config.roundingKg)}
                  className="num flex h-10 w-10 items-center justify-center border-2 border-ink text-[17px] leading-none font-extrabold"
                >
                  +
                </button>
                <span className="text-[10px] leading-none font-semibold tracking-[0.1em] uppercase opacity-70">
                  kg del sustituto
                </span>
              </>
            ) : null}
          </div>
        ) : null}
      </section>

      {/* One pill per prescribed set. A logged pill re-opens the picker
          for THAT set — a wrong value is never permanent. */}
      <div className="flex flex-none gap-0.5 bg-line py-0.5">
        {Array.from({ length: exercise.sets }, (_, i) => {
          const entry = logs[keyOf(exercise.id, i)];
          const bad = entry?.missed ?? false;
          const editing = editingIndex === i;
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
                "flex h-[62px] flex-1 flex-col items-center justify-center gap-1 border-2 box-border",
                entry
                  ? bad
                    ? "border-fail bg-fail/10"
                    : "border-ok bg-ok/10"
                  : "border-quiet bg-paper",
                editing && "border-ink",
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
            </button>
          );
        })}
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-4 pt-3.5 pb-4">
        {/* Pre-session block: activación + the engine's approach ramp.
            Nothing here logs — it exists so the first work set is not
            the first thing the knee feels. */}
        {exIndex === 0 && primary?.weightKg != null ? (
          warmupOpen ? (
            <div className="mb-3.5 border-2 border-hairline px-3 pt-1 pb-3">
              <button
                type="button"
                onClick={() => setWarmupOpen(false)}
                className="flex h-10 w-full items-center justify-between text-left"
              >
                <span className="text-[12px] leading-none font-bold">
                  calentamiento
                </span>
                <span className="text-[10px] leading-none font-semibold tracking-[0.1em] text-mid uppercase">
                  cerrar
                </span>
              </button>
              <div className="mt-1 text-[10px] leading-none font-extrabold tracking-[0.14em] text-mid uppercase">
                activación
              </div>
              <div className="mt-2 flex flex-col gap-px bg-line">
                {ACTIVATION_ITEMS.map((item, i) => (
                  <button
                    key={item}
                    type="button"
                    onClick={() =>
                      setActivationDone((prev) =>
                        prev.map((v, j) => (j === i ? !v : v)),
                      )
                    }
                    className="flex h-11 items-center gap-2.5 bg-paper px-1 text-left"
                  >
                    <span
                      className={cn(
                        "w-3.5 text-[11px] leading-none font-extrabold",
                        activationDone[i] ? "text-ok" : "text-quiet",
                      )}
                    >
                      {activationDone[i] ? "✓" : "·"}
                    </span>
                    <span
                      className={cn(
                        "text-[13px] leading-[1.2] font-semibold",
                        activationDone[i] && "text-mid",
                      )}
                    >
                      {item}
                    </span>
                  </button>
                ))}
              </div>
              <p className="mt-2 text-[11px] leading-[1.45] text-faint">
                contra la amnesia glútea: 5′ y al rack.
              </p>
              {warmup.length > 0 ? (
                <>
                  <div className="mt-3 text-[10px] leading-none font-extrabold tracking-[0.14em] text-mid uppercase">
                    aproximación
                  </div>
                  <div className="mt-2 flex flex-col gap-px bg-line">
                    {warmup.map((w, i) => (
                      <div
                        key={i}
                        className="flex items-baseline gap-2.5 bg-paper px-1 py-2.5"
                      >
                        <span className="num min-w-[62px] text-[12.5px] leading-none font-extrabold">
                          {formatWeight(w.weightKg)} kg
                        </span>
                        <span className="num text-[11px] leading-none text-mid">
                          × {w.reps}
                        </span>
                        <span className="num ml-auto text-[11px] leading-none text-mid">
                          {Math.round(w.pct * 100)} %
                        </span>
                      </div>
                    ))}
                  </div>
                  <p className="mt-2 text-[11px] leading-[1.45] text-faint">
                    aproximación al básico del día — no se registra.
                  </p>
                </>
              ) : null}
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setWarmupOpen(true)}
              className="mb-3.5 flex w-full items-center justify-between border-2 border-dashed border-hairline px-3 py-3 text-left"
            >
              <span className="text-[12px] leading-none font-bold">
                calentamiento
              </span>
              <span className="text-[10px] leading-none font-semibold tracking-[0.1em] text-mid uppercase">
                activación + aproximación
              </span>
            </button>
          )
        ) : null}

        {primarySub ? (
          <p className="mb-3 border-l-[6px] border-warn py-1 pl-3 text-[12px] leading-[1.5]">
            hoy la sesión no mueve el motor: molestia registrada.
          </p>
        ) : null}

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
            <span
              className={cn(
                "text-[10px] leading-none font-extrabold tracking-[0.12em] uppercase",
                banner.tone === "warn" ? "text-warn" : "text-fail",
              )}
            >
              {banner.title}
            </span>
            <p className="mt-2 text-[12px] leading-[1.5] opacity-80">
              {banner.detail}
            </p>
            {lastLiveFailure ? (
              /* Undoing an engine action is a first-class move — a real
                 block target (the RestBar standard), not a 10px link. */
              <button
                type="button"
                onClick={undoFailure}
                className="mt-3 flex h-11 w-full items-center justify-center bg-ink-2 text-[13px] leading-none font-bold tracking-[0.06em] uppercase"
              >
                deshacer
              </button>
            ) : null}
          </div>
        ) : null}

        {subPickerOpen ? (
          <div className="mt-3.5">
            <div className="text-[10px] leading-none font-extrabold tracking-[0.14em] text-mid uppercase">
              molestia en {exercise.name.toLowerCase()} — elige sustituto
            </div>
            <div className="mt-2.5 flex flex-col gap-px bg-line">
              {subOptions.map((o) => (
                <button
                  key={o.slug}
                  type="button"
                  onClick={() => chooseSub(o)}
                  className="flex min-h-11 flex-col justify-center gap-1 bg-paper px-1 py-2.5 text-left"
                >
                  <span
                    className={cn(
                      "text-[13px] leading-[1.2] font-semibold",
                      sub?.slug === o.slug && "text-ok",
                    )}
                  >
                    {sub?.slug === o.slug ? "✓ " : ""}
                    {o.name}
                  </span>
                  {o.cue ? (
                    <span className="text-[11px] leading-[1.35] text-mid">
                      {o.cue}
                    </span>
                  ) : null}
                </button>
              ))}
              {sub ? (
                <button
                  type="button"
                  onClick={clearSub}
                  className="flex min-h-11 items-center bg-paper px-1 py-2.5 text-left text-[13px] leading-[1.2] font-semibold text-mid"
                >
                  seguir con {exercise.name.toLowerCase()}
                </button>
              ) : null}
            </div>
            <p className="mt-2.5 text-[11px] leading-[1.45] text-faint">
              las series se siguen registrando, con los kilos editables;
              el motor no se mueve con una sustitución.
            </p>
          </div>
        ) : null}

        {repsOpen ? (
          <div className="mt-3.5">
            <div className="text-[10px] leading-none font-extrabold tracking-[0.14em] text-mid uppercase">
              {editingIndex != null
                ? `Corregir serie ${editingIndex + 1}`
                : exercise.effort === "seconds"
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
                  onClick={() => record(n, editingIndex)}
                  className={cn(
                    "num flex h-11 w-11 items-center justify-center border-2 text-[17px] leading-none font-extrabold",
                    // repFloor, not repMin: the 85 % week forgives a rep.
                    n < exercise.repFloor
                      ? "border-fail text-fail"
                      : "border-ink text-ink",
                  )}
                >
                  {n}
                </button>
              ))}
            </div>
            <p className="mt-2.5 text-[11px] leading-[1.45] text-faint">
              Por debajo de {exercise.repFloor}{" "}
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
                  setEditingIndex(null);
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

        {/* All sets in: the session is complete but nothing closes on
            its own — a mis-tapped last set stays correctable from its
            pill, and the note travels in the same finish op partials
            use. Only the bar below commits. */}
        {sessionComplete ? (
          <div className="mt-4 border-2 border-ok px-3 py-3">
            <div className="text-[10px] leading-none font-extrabold tracking-[0.12em] text-ok uppercase">
              sesión completa
            </div>
            <p className="mt-2 text-[11.5px] leading-[1.45] text-mid">
              corrige cualquier serie desde su pastilla; nada se cierra
              hasta «terminar sesión».
            </p>
            <textarea
              value={finishNotes}
              onChange={(e) => setFinishNotes(e.target.value)}
              rows={2}
              maxLength={2000}
              placeholder="Nota de la sesión — «rodilla bien», «última serie justa»… (opcional)"
              aria-label="Nota de la sesión"
              className="mt-2.5 w-full border-2 border-hairline bg-paper px-2.5 py-2 text-[12px] leading-[1.4] outline-none"
            />
          </div>
        ) : null}

        {/* Explicit exit: the gym closes, the shoulder hurts — a session
            can close as partial without inventing sets. */}
        {totalDone < totalSets ? (
          confirmFinish ? (
            <div className="mt-4 border-2 border-fail px-3 py-3">
              <div className="flex items-center gap-2.5">
                <span className="flex-1 text-[12px] leading-[1.35] font-bold">
                  ¿Terminar con {totalSets - totalDone}{" "}
                  {totalSets - totalDone === 1 ? "serie" : "series"} sin hacer?
                </span>
                <button
                  type="button"
                  disabled={pending}
                  onClick={finish}
                  className="flex h-9 items-center bg-ink px-3 text-[11px] leading-none font-extrabold tracking-[0.06em] text-paper uppercase"
                >
                  Sí, terminar
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmFinish(false)}
                  className="text-[11px] leading-none font-medium text-mid underline"
                >
                  seguir
                </button>
              </div>
              <textarea
                value={finishNotes}
                onChange={(e) => setFinishNotes(e.target.value)}
                rows={2}
                maxLength={2000}
                placeholder="Por qué cierras antes — «aquíleo molesto», «sin tiempo»… (opcional)"
                aria-label="Nota de la sesión"
                className="mt-2.5 w-full border-2 border-hairline bg-paper px-2.5 py-2 text-[12px] leading-[1.4] outline-none"
              />
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmFinish(true)}
              className="mt-4 flex w-full items-center justify-between border-2 border-dashed border-hairline px-3 py-3 text-left"
            >
              <span className="text-[12px] leading-none font-bold">
                Terminar sesión
              </span>
              <span className="num text-[11px] leading-none text-mid">
                {totalDone}/{totalSets} series
              </span>
            </button>
          )
        ) : null}
      </div>

      <div className="flex flex-none">
        {sessionComplete ? (
          /* The explicit close — the only way a complete session ends. */
          <button
            type="button"
            disabled={pending}
            onClick={finish}
            className="flex h-[66px] flex-1 items-center justify-center bg-ink text-[17px] leading-none font-extrabold tracking-[0.06em] text-paper uppercase active:opacity-85 disabled:opacity-60"
          >
            Terminar sesión
          </button>
        ) : (
          <>
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
              onClick={() => {
                // Always a FRESH set from here — a pill left in edit mode
                // must not make this overwrite an old value.
                setEditingIndex(null);
                setRepsOpen((v) => !v);
              }}
              className="flex h-[66px] w-[92px] flex-col items-center justify-center gap-1 bg-ink text-[11px] leading-none font-semibold text-paper"
            >
              <span>OTRAS</span>
              <span className="opacity-60">REPS</span>
            </button>
          </>
        )}
      </div>

      {rest ? (
        <RestBar rest={rest} onSkip={stop} onExtend={() => extend(30)} />
      ) : overdue != null ? (
        <RestOverdue seconds={overdue} />
      ) : null}

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
