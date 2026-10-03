"use client";

import {
  Check,
  List,
  Minus,
  Plus,
  Snowflake,
  TriangleAlert,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";

import { Card, Note, SessionRow, fitFontSize } from "@/components/ui/kit";
import { TONE } from "@/components/day-accents";
import { PlateBar, perSideLabel } from "@/components/plate-bar";
import { RestBar, useRestTimer, useWakeLock } from "@/components/session/rest-timer";
import {
  restNotificationsEnabled,
  useSessionNotification,
} from "@/components/session/session-notification";
import {
  formatWeight,
  loadableWeight,
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
  removeLocalSet,
  setLocalWeight,
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
  rir: number | null;
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
    `weightKg` is the load actually moved, not necessarily the plan's.
    `rir` rides along so a later weight edit cannot erase it. */
type LogMap = Record<
  string,
  {
    value: number;
    missed: boolean;
    weightKg: number | null;
    rir: number | null;
  }
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
  /** The whole-session list, behind the top-right button. */
  const [listOpen, setListOpen] = useState(false);
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
        rir: l.rir,
      };
    }
    return map;
  });

  /** Load the athlete moved to with the stepper, per exercise: what the
      next set of it goes on until another set says otherwise. */
  const [weights, setWeights] = useState<Record<string, number>>({});
  /** Direct weight entry: tap the stepper value, type the number. */
  const [weightEditing, setWeightEditing] = useState(false);
  const [weightDraft, setWeightDraft] = useState("");

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

  // Read once on mount: the toggle lives in Ajustes, a session apart.
  const [notifEnabled] = useState(() => restNotificationsEnabled());
  const notif = useSessionNotification({ enabled: notifEnabled, vibration });

  const { rest, flash, start, stop, extend, resume } = useRestTimer({
    sound,
    vibration,
    // Persist the deadline: a reload mid-rest keeps counting.
    onChange: (snapshot) => void withLocal((s) => ({ ...s, rest: snapshot })),
    onExpire: () => notif.showExpired(),
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
              rir: entry.rir,
            };
          }
        }
        // Unlogged sets whose delete has not flushed yet: the server-
        // seeded row must not resurrect them.
        for (const k of local.removed ?? []) {
          const [pos, idx] = k.split(":").map(Number);
          const ex = exercises.find((e) => e.position === pos);
          if (ex) delete next[keyOf(ex.id, idx)];
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
      if (local.weights) {
        // Stepper overrides made before any set — position → exercise.
        setWeights((prev) => {
          const next = { ...prev };
          for (const [pos, kg] of Object.entries(local.weights ?? {})) {
            const ex = exercises.find((e) => e.position === Number(pos));
            if (ex && !(ex.id in next)) next[ex.id] = kg;
          }
          return next;
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

  // The next set to log is the first WITHOUT an entry, not "count done":
  // deleting a set leaves a gap, and the gap is what gets filled next.
  const nextFreeIndex = (() => {
    for (let i = 0; i < exercise.sets; i++) {
      if (!logs[keyOf(exercise.id, i)]) return i;
    }
    return exercise.sets;
  })();
  const totalSets = exercises.reduce((acc, e) => acc + e.sets, 0);
  const totalDone = exercises.reduce(
    (acc, e) => acc + countDone(logs, e.id, e.sets),
    0,
  );

  // The quiet between-rests card when the app goes to the background.
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === "hidden" && !rest) {
        notif.showProgress(exercise.name, totalDone, totalSets);
      }
    };
    document.addEventListener("visibilitychange", onHide);
    return () => document.removeEventListener("visibilitychange", onHide);
  }, [rest, exercise.name, totalDone, totalSets, notif]);

  /** The other members of this exercise's superset, in plan order. */
  const groupMembers = useMemo(
    () =>
      exercise.supersetGroup == null
        ? [exercise]
        : exercises.filter((e) => e.supersetGroup === exercise.supersetGroup),
    [exercise, exercises],
  );

  function finish() {
    notif.clear();
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
    const setIndex = atIndex ?? nextFreeIndex;
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
    setLogs((prev) => ({ ...prev, [k]: { value, missed, weightKg, rir } }));
    // What you just moved is what the next set starts from — but only a
    // FRESH set: correcting an old set's reps must not resurrect that
    // set's old weight as the next set's default.
    if (!overwrite && weightKg != null) {
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
        notif.showRest(
          exercise.name,
          setIndex + 1,
          exercise.sets,
          exercise.restSeconds,
        );
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
   * path a first write does; otherwise it sets what the next set uses,
   * persisted so a killed tab before the first set still remembers it.
   */
  function applyWeight(next: number) {
    if (next === currentWeight) return;

    const setIndex = editingIndex;
    const editing = setIndex == null ? null : logs[keyOf(exercise.id, setIndex)];
    if (!editing || setIndex == null) {
      // A fresh-set change IS the next set's default, and persists so a
      // killed tab before the first set still remembers it.
      setWeights((prev) => ({ ...prev, [exercise.id]: next }));
      startTransition(async () => {
        await withLocal((s) => setLocalWeight(s, exercise.position, next));
      });
      return;
    }

    // Editing an old set fixes THAT set: the next-set default stays put,
    // same rule record() enforces for rep corrections.
    setLogs((prev) => ({
      ...prev,
      [keyOf(exercise.id, setIndex)]: { ...editing, weightKg: next },
    }));
    const timed = exercise.effort === "seconds";
    const loggedAt = new Date().toISOString();
    // Only the load changes: the set's stored RIR travels untouched. It
    // lives in the logs map (seeded from the server), so correcting an
    // old session whose local mirror was pruned cannot erase it.
    const rir = editing.rir;
    startTransition(async () => {
      await withLocal((s) =>
        recordLocalSet(s, {
          position: exercise.position,
          setIndex,
          value: editing.value,
          missed: editing.missed,
          weightKg: next,
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
        reps: timed ? null : editing.value,
        seconds: timed ? editing.value : null,
        rir,
        weightKg: next,
        loggedAt,
      });
    });
  }

  function nudgeWeight(direction: 1 | -1) {
    if (currentWeight == null) return;
    applyWeight(
      nextLoadableWeight(
        currentWeight,
        direction,
        exercise.equipment,
        replayCtx.config,
      ),
    );
  }

  /** Direct entry: the athlete proposes a number, `loadableWeight`
      disposes — the engine stays the only load authority. */
  function commitWeightDraft() {
    setWeightEditing(false);
    const parsed = Number.parseFloat(weightDraft.trim().replace(",", "."));
    if (!Number.isFinite(parsed) || parsed <= 0) return;
    const snapped = loadableWeight(parsed, exercise.equipment, replayCtx.config);
    if (snapped > 0) applyWeight(snapped);
  }

  /**
   * Unmark a set: the mis-tap stops counting as done. The op shares the
   * set_log key, so exactly one of {log, unlog} per set ever flushes;
   * server-side the row is deleted and the replay heals the engine.
   */
  function unlogSet(setIndex: number) {
    const k = keyOf(exercise.id, setIndex);
    if (!logs[k]) return;
    setLogs((prev) => {
      const next = { ...prev };
      delete next[k];
      return next;
    });
    setRepsOpen(false);
    setEditingIndex(null);
    setPendingRir(null);
    startTransition(async () => {
      await withLocal((s) => removeLocalSet(s, exercise.position, setIndex));
      await enqueueAndFlush({
        kind: "set_unlog",
        localSessionId: sessionId,
        position: exercise.position,
        setIndex,
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
      for (let n = 5; n <= top; n += 5) out.push(n);
      return out;
    }
    // AMRAP gets generous headroom; plain reps a little slack over the top.
    // Short ranges start at 1; long ones start well under the minimum so
    // the grid stays a couple of rows.
    const top = exercise.effort === "amrap" ? exercise.repMax + 8 : exercise.repMax + 2;
    const low = top <= 15 ? 1 : Math.max(1, exercise.repMin - 6);
    for (let n = low; n <= top; n++) out.push(n);
    return out;
  }, [exercise.repMin, exercise.repMax, exercise.effort]);

  /**
   * What one tap on "Hecho" logs. Never the top of the range by default:
   * all sets at the top is exactly what bumps an accessory, so the laziest
   * tap must not be the one that moves a load. The first set of an
   * exercise logs the range minimum; after that, whatever the athlete
   * last logged on it — pick 8 once with "Otras" and the rest follow.
   */
  const quickValue = (() => {
    for (let i = nextFreeIndex - 1; i >= 0; i--) {
      const entry = logs[keyOf(exercise.id, i)];
      if (entry) return entry.value;
    }
    for (let i = exercise.sets - 1; i >= 0; i--) {
      const entry = logs[keyOf(exercise.id, i)];
      if (entry) return entry.value;
    }
    return exercise.repMin;
  })();

  const setNumber = Math.min(nextFreeIndex + 1, exercise.sets);
  const eyebrow = exercise.isPrimary
    ? `Básico del día · serie ${setNumber} de ${exercise.sets}`
    : exercise.supersetGroup != null
      ? `Superserie · serie ${setNumber} de ${exercise.sets}`
      : `Ejercicio ${exIndex + 1} de ${exercises.length} · serie ${setNumber} de ${exercise.sets}`;
  const load =
    currentWeight == null || !exercise.plates
      ? null
      : currentWeight === exercise.weightKg
        ? exercise.plates
        : plateBreakdown(currentWeight, replayCtx.config);
  const plates = showPlates && load && !load.barOnly ? load : null;
  const nextExercise =
    exercises[Math.min(exIndex, exercises.length - 1) + 1] ?? null;

  const editingLogged =
    editingIndex != null && Boolean(logs[keyOf(exercise.id, editingIndex)]);
  const unit =
    exercise.loadMode === "rpe"
      ? "sensación"
      : exercise.loadMode === "bodyweight"
        ? "corporal"
        : "kg";
  const loadNote =
    plates && plates.perSide.length > 0
      ? perSideLabel(plates.perSide)
      : exercise.equipment === "barbell"
        ? "solo la barra"
        : exercise.equipment === "dumbbell" || exercise.equipment === "kettlebell"
          ? "por mano"
          : exercise.equipment === "pulley"
            ? "en la polea"
            : exercise.equipment === "machine"
              ? "en la máquina"
              : exercise.loadMode === "weighted_bodyweight"
                ? "de lastre"
                : exercise.loadMode === "bodyweight"
                  ? "sin lastre"
                  : null;
  const programmed =
    exercise.weightKg != null &&
    currentWeight != null &&
    currentWeight !== exercise.weightKg
      ? `programado ${formatWeight(exercise.weightKg)}`
      : null;
  const canStep = exercise.loadMode !== "rpe" && currentWeight != null;
  const round =
    "flex h-10 w-10 flex-none items-center justify-center rounded-full bg-surface text-ink shadow-raised";
  const stepButton =
    "flex h-[52px] w-[52px] flex-none items-center justify-center rounded-full bg-soft text-ink active:opacity-70";
  const tile = "rounded-xl bg-surface px-3.5 py-3 shadow-raised";
  const finishedAll = totalDone >= totalSets;
  const heroWeight =
    exercise.loadMode === "rpe" || currentWeight == null
      ? "—"
      : exercise.loadMode === "weighted_bodyweight"
        ? `+${formatWeight(currentWeight)}`
        : formatWeight(currentWeight);

  return (
    // Phone: pinned to the viewport like the tab bar, so "Hecho" sits on
    // the bottom edge whatever the page height — a min-h-dvh column let
    // the runner grow past the screen and pushed the bar under it.
    <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden bg-bg max-md:fixed max-md:inset-0 max-md:z-10">
      <div className="flex flex-none items-center gap-3 px-4 pt-4">
        <button
          type="button"
          aria-label="Salir de la sesión"
          onClick={() => router.push("/")}
          className={round}
        >
          <X aria-hidden size={18} strokeWidth={2.25} />
        </button>
        <div className="min-w-0 flex-1 text-center">
          <div className="truncate text-[15px] leading-[1.2] font-extrabold">
            {label}
          </div>
          <div className="num mt-0.5 text-[12px] leading-none font-semibold text-mid">
            {totalDone} de {totalSets} series
          </div>
        </div>
        <button
          type="button"
          aria-label="Toda la sesión"
          aria-expanded={listOpen}
          onClick={() => setListOpen(true)}
          className={round}
        >
          <List aria-hidden size={18} strokeWidth={2.25} />
        </button>
      </div>

      {/* One segment per exercise, as long as its sets: the bar reads as
          the session's shape, not just a percentage. */}
      <div className="mx-5 mt-3.5 flex flex-none gap-1">
        {exercises.map((e) => (
          <div
            key={e.id}
            className="h-1.5 overflow-hidden rounded-full bg-quiet"
            style={{ flex: e.sets }}
          >
            <div
              className="h-full rounded-full bg-clay-line transition-[width] duration-200"
              style={{
                width: `${Math.round((countDone(logs, e.id, e.sets) / e.sets) * 100)}%`,
              }}
            />
          </div>
        ))}
      </div>

      <div className="no-scrollbar min-h-0 flex-1 overflow-auto px-5 pt-5.5 pb-4">
        <div className="text-[11px] leading-none font-bold tracking-[0.13em] text-clay uppercase">
          {eyebrow}
        </div>
        <h1 className="mt-1.5 text-[26px] leading-[1.15] font-extrabold tracking-[-0.02em]">
          {exercise.name}
        </h1>

        {/* The load is the athlete's to change: the plan prescribes, the
            bar decides. Each notch is a weight the equipment can rack. */}
        <div className="mt-4 rounded-3xl bg-surface px-3.5 pt-4.5 pb-4 shadow-card">
          {editingLogged ? (
            <div className="mb-2 text-center text-[12px] leading-none font-bold text-clay">
              Peso de la serie {editingIndex! + 1}
            </div>
          ) : null}
          <div className="flex items-center gap-2">
            {canStep ? (
              <button
                type="button"
                aria-label="Bajar peso"
                onClick={() => nudgeWeight(-1)}
                className={stepButton}
              >
                <Minus aria-hidden size={20} strokeWidth={2.25} />
              </button>
            ) : null}
            <div className="@container flex min-w-0 flex-1 items-baseline justify-center gap-1.5">
              {weightEditing ? (
                <input
                  autoFocus
                  inputMode="decimal"
                  value={weightDraft}
                  aria-label="Peso en kg"
                  onChange={(e) => setWeightDraft(e.target.value)}
                  onBlur={commitWeightDraft}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") e.currentTarget.blur();
                    if (e.key === "Escape") {
                      setWeightDraft("");
                      setWeightEditing(false);
                    }
                  }}
                  className="num w-full min-w-0 bg-transparent text-center leading-[0.95] font-extrabold tracking-[-0.04em] outline-none"
                  style={fitFontSize(weightDraft || "0", 72, 32)}
                />
              ) : (
                <button
                  type="button"
                  disabled={!canStep}
                  aria-label={canStep ? "Escribir el peso" : undefined}
                  onClick={() => {
                    if (currentWeight == null) return;
                    setWeightDraft(formatWeight(currentWeight));
                    setWeightEditing(true);
                  }}
                  className="num min-w-0 leading-[0.95] font-extrabold tracking-[-0.04em] whitespace-nowrap text-ink disabled:opacity-100"
                  style={fitFontSize(heroWeight, 80, 32)}
                >
                  {heroWeight}
                </button>
              )}
              <span className="flex-none text-[20px] leading-none font-bold text-mid">
                {unit}
              </span>
            </div>
            {canStep ? (
              <button
                type="button"
                aria-label="Subir peso"
                onClick={() => nudgeWeight(1)}
                className={stepButton}
              >
                <Plus aria-hidden size={20} strokeWidth={2.25} />
              </button>
            ) : null}
          </div>
          {plates || loadNote || programmed ? (
            <div className="mt-3 flex min-h-10 items-center justify-center gap-3">
              {plates && plates.perSide.length > 0 ? (
                <PlateBar perSide={plates.perSide} scale={40 / 44} />
              ) : null}
              <span className="num text-[13px] leading-[1.3] font-semibold text-mid">
                {[loadNote, programmed].filter(Boolean).join(" · ")}
                {plates?.remainderKg ? (
                  <span className="text-fail">
                    {" "}
                    · +{formatWeight(plates.remainderKg)} sin disco
                  </span>
                ) : null}
              </span>
            </div>
          ) : null}
        </div>

        {/* The two numbers read mid-set, with chalk on the hands: the rep
            target and the rest get their own tiles, not hero fine print. */}
        <div className="mt-2.5 grid grid-cols-3 gap-2">
          <div className={tile}>
            <div className="text-[11px] leading-none font-semibold text-mid">
              Objetivo
            </div>
            <div className="num mt-1.5 text-[18px] leading-none font-extrabold">
              {exercise.repsLabel.replace("-", "–")}
              {exercise.effort === "seconds" ? "″" : ""}
            </div>
          </div>
          <div className={tile}>
            <div className="text-[11px] leading-none font-semibold text-mid">
              RIR
            </div>
            <div className="num mt-1.5 text-[18px] leading-none font-extrabold">
              {exercise.isPrimary ? targetRir.replace("-", "–") : "—"}
            </div>
          </div>
          <div className={tile}>
            <div className="text-[11px] leading-none font-semibold text-mid">
              Descanso
            </div>
            <div className="num mt-1.5 text-[18px] leading-none font-extrabold">
              {exercise.restLabel}
            </div>
          </div>
        </div>

        {/* One pill per prescribed set. A logged pill re-opens the picker
            for THAT set — a wrong value is never permanent. */}
        <div className="mt-3.5 flex gap-2">
          {Array.from({ length: exercise.sets }, (_, i) => {
            const entry = logs[keyOf(exercise.id, i)];
            const bad = entry?.missed ?? false;
            const editing = editingIndex === i && repsOpen;
            const current = !entry && i === nextFreeIndex;
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
                  "flex h-16 min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-xl",
                  entry
                    ? bad
                      ? "bg-fail-soft text-fail"
                      : "bg-strength text-on-strength"
                    : current
                      ? "bg-surface text-ink shadow-[inset_0_0_0_2px_var(--clay-line)]"
                      : "bg-quiet text-mid",
                  editing && "ring-2 ring-ink ring-offset-2 ring-offset-bg",
                )}
              >
                <span className="num text-[22px] leading-none font-extrabold">
                  {entry ? entry.value : i + 1}
                </span>
                <span
                  className={cn(
                    "text-[11px] leading-none font-semibold",
                    entry && !bad && "text-white/85",
                    current && "text-clay",
                  )}
                >
                  {entry
                    ? bad
                      ? "bajo rango"
                      : exercise.effort === "seconds"
                        ? "seg"
                        : "reps"
                    : current
                      ? "ahora"
                      : "queda"}
                </span>
              </button>
            );
          })}
        </div>

        {banner ? (
          <Note
            className="mt-3.5"
            tone={banner.tone === "warn" ? "warn" : "clay"}
            icon={
              banner.tone === "warn" ? (
                <Snowflake size={18} />
              ) : (
                <TriangleAlert size={18} />
              )
            }
            title={banner.title}
            action={
              lastLiveFailure ? (
                <button
                  type="button"
                  onClick={undoFailure}
                  className="text-[13px] leading-none font-bold text-clay"
                >
                  Deshacer
                </button>
              ) : null
            }
          >
            {banner.detail}
          </Note>
        ) : null}

        {rest ? (
          <div className="mt-3.5">
            <RestBar
              rest={rest}
              onSkip={() => {
                stop();
                notif.dismissRest(exercise.name, totalDone, totalSets);
              }}
              onExtend={() => {
                extend(30);
                notif.extendRest(rest.left + 30);
              }}
            />
          </div>
        ) : null}

        {nextExercise ? (
          <div className="mt-4 flex items-center gap-2.5 px-1">
            <span className="flex-none text-[12px] leading-none font-semibold text-mid">
              Siguiente
            </span>
            <span className="min-w-0 flex-1 truncate text-[14px] leading-[1.2] font-bold">
              {nextExercise.name}
            </span>
            <span className="num flex-none text-[13px] leading-none font-semibold text-mid">
              {nextExercise.schemeLabel} ·{" "}
              {weightLabelFor(nextExercise.loadMode, weightAt(nextExercise, null))}
            </span>
          </div>
        ) : null}

        {error ? (
          <Card className="mt-4 bg-fail-soft px-4 py-3.5 text-[12.5px] leading-[1.5] font-medium text-fail shadow-none">
            {error}
          </Card>
        ) : null}

        {exercise.notes ? (
          <p className="mt-4 px-1 text-[12.5px] leading-[1.5] font-medium text-mid">
            {exercise.notes}
          </p>
        ) : null}

        {/* Explicit exit: the gym closes, the shoulder hurts — a session
            can close as partial without inventing sets. A complete one
            confirms too: the last set never registers the day by itself. */}
        {!confirmFinish ? (
          <button
            type="button"
            onClick={() => setConfirmFinish(true)}
            className="mt-5 flex w-full items-center justify-between rounded-xl border border-dashed border-hairline px-4 py-3.5 text-left"
          >
            <span className="text-[14px] leading-none font-bold">
              Terminar sesión
            </span>
            <span className="num text-[12.5px] leading-none font-semibold text-mid">
              {totalDone} de {totalSets} series
            </span>
          </button>
        ) : (
          <div ref={finishRef}>
            <Card
              className={cn(
                "mt-4 px-4 py-4",
                finishedAll ? "" : "shadow-[inset_0_0_0_1.5px_var(--fail)]",
              )}
            >
              {finishedAll ? (
                <span className="flex h-11 w-11 items-center justify-center rounded-lg bg-ok-soft text-ok">
                  <Check aria-hidden size={22} strokeWidth={2.5} />
                </span>
              ) : null}
              <div
                className={cn(
                  "text-[18px] leading-[1.25] font-extrabold tracking-[-0.01em]",
                  finishedAll && "mt-3",
                )}
              >
                {finishedAll ? (
                  <>Sesión completa</>
                ) : (
                  <>
                    ¿Terminar con {totalSets - totalDone}{" "}
                    {totalSets - totalDone === 1 ? "serie" : "series"} sin
                    hacer?
                  </>
                )}
              </div>
              <textarea
                value={finishNotes}
                onChange={(e) => setFinishNotes(e.target.value)}
                rows={2}
                maxLength={2000}
                placeholder={
                  finishedAll
                    ? "Nota de la sesión — «última serie dura», «buenas sensaciones»… (opcional)"
                    : "Por qué cierras antes — «aquíleo molesto», «sin tiempo»… (opcional)"
                }
                aria-label="Nota de la sesión"
                className="mt-3 w-full rounded-lg bg-soft px-3.5 py-3 text-[13px] leading-[1.45] font-medium outline-none"
              />
              <div className="mt-3 flex items-center gap-4">
                <button
                  type="button"
                  disabled={pending}
                  onClick={finish}
                  className="flex h-12 flex-1 items-center justify-center rounded-xl bg-strength text-[15px] leading-none font-bold text-on-strength shadow-cta disabled:opacity-40"
                >
                  {finishedAll ? "Terminar y registrar" : "Sí, terminar"}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmFinish(false)}
                  className="px-2 text-[14px] leading-none font-bold text-mid"
                >
                  Seguir
                </button>
              </div>
            </Card>
          </div>
        )}
      </div>

      <div className="flex flex-none gap-2.5 px-4 pt-3 pb-[calc(1.75rem+var(--safe-bottom))]">
        <button
          type="button"
          disabled={pending}
          onClick={() => {
            if (exercise.effort === "amrap") {
              setEditingIndex(null);
              setRepsOpen(true);
              return;
            }
            record(quickValue);
          }}
          className="flex h-16 flex-1 items-center justify-center gap-2 rounded-2xl bg-strength text-[17px] leading-none font-bold text-on-strength shadow-cta active:opacity-85 disabled:opacity-40"
        >
          <Check aria-hidden size={20} strokeWidth={2.5} />
          {exercise.effort === "amrap" ? (
            "Registrar AMRAP"
          ) : (
            <>
              Hecho ·{" "}
              <span className="num">
                {quickValue}
                {exercise.effort === "seconds" ? "″" : " reps"}
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
            setRepsOpen(true);
          }}
          className="flex h-16 w-24 flex-none items-center justify-center rounded-2xl bg-surface text-[15px] leading-none font-bold text-ink shadow-raised"
        >
          Otras
        </button>
      </div>

      {repsOpen ? (
        <Sheet
          onClose={() => {
            setRepsOpen(false);
            setEditingIndex(null);
            setPendingRir(null);
          }}
        >
          <div className="flex items-baseline gap-2">
            <span className="flex-1 text-[18px] leading-tight font-extrabold tracking-[-0.01em]">
              {editingLogged
                ? `Corregir serie ${editingIndex! + 1}`
                : exercise.effort === "seconds"
                  ? "Segundos aguantados"
                  : exercise.effort === "amrap"
                    ? "Reps completadas · AMRAP"
                    : "Reps completadas"}
            </span>
            <span className="num text-[13px] leading-none font-semibold text-mid">
              objetivo {exercise.repsLabel.replace("-", "–")}
              {exercise.effort === "seconds" ? "″" : ""}
            </span>
          </div>
          <div className="mt-3.5 flex items-center gap-1.5">
            <span className="w-9 flex-none text-[12px] leading-none font-bold text-mid">
              RIR
            </span>
            {[0, 1, 2, 3, 4].map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setPendingRir((v) => (v === n ? null : n))}
                className={cn(
                  "num h-10 flex-1 rounded-md text-[15px] leading-none font-bold",
                  pendingRir === n
                    ? "bg-strength text-on-strength"
                    : "bg-soft text-ink",
                )}
              >
                {n}
              </button>
            ))}
            <span className="flex-none text-[11px] leading-none font-semibold text-mid">
              opcional
            </span>
          </div>
          <div className="mt-3 grid grid-cols-5 gap-2">
            {repOptions.map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => record(n, editingIndex)}
                className={cn(
                  "num h-[52px] rounded-lg text-[19px] leading-none font-extrabold",
                  n < exercise.repMin
                    ? "bg-fail-soft text-fail"
                    : "bg-soft text-ink",
                )}
              >
                {n}
              </button>
            ))}
          </div>
          <p className="mt-3.5 text-[12.5px] leading-[1.5] font-medium text-mid">
            Por debajo de {exercise.repMin}{" "}
            {exercise.isPrimary
              ? "el motor reacciona: primero congela el peso, luego recorta la RM."
              : "no pasa nada: los accesorios no tocan el motor."}
          </p>
          {editingLogged ? (
            <button
              type="button"
              onClick={() => unlogSet(editingIndex!)}
              className="mt-3 text-[13px] leading-none font-bold text-fail"
            >
              Borrar la serie {editingIndex! + 1} — queda sin hacer
            </button>
          ) : null}
        </Sheet>
      ) : null}

      {listOpen ? (
        <Sheet onClose={() => setListOpen(false)}>
          <div className="flex items-baseline gap-2">
            <span className="flex-1 text-[18px] leading-tight font-extrabold tracking-[-0.01em]">
              Toda la sesión
            </span>
            <span className="num text-[13px] leading-none font-semibold text-mid">
              {totalDone} de {totalSets} series
            </span>
          </div>
          <div className="-mx-2 mt-2 flex max-h-[55dvh] flex-col gap-0.5 overflow-auto">
            {exercises.map((e, i) => {
              const done = countDone(logs, e.id, e.sets);
              const complete = done >= e.sets;
              return (
                <SessionRow
                  key={e.id}
                  accent={
                    complete
                      ? TONE.okBright
                      : i === exIndex
                        ? "var(--clay-line)"
                        : TONE.hairline
                  }
                  title={e.name}
                  status={complete ? "Hecha" : i === exIndex ? "Ahora" : undefined}
                  statusTone={complete ? "text-ok" : "text-clay"}
                  primary={weightLabelFor(e.loadMode, weightAt(e, null))}
                  secondary={`${done}/${e.sets}`}
                  muted={complete}
                  className={i === exIndex ? "bg-clay-soft" : undefined}
                  onClick={() => {
                    setExIndex(i);
                    if (failureKey) setDismissedFailure(failureKey);
                    setRepsOpen(false);
                    setEditingIndex(null);
                    setListOpen(false);
                  }}
                />
              );
            })}
          </div>
          {!confirmFinish ? (
            <button
              type="button"
              onClick={() => {
                setListOpen(false);
                setConfirmFinish(true);
              }}
              className="mt-3 flex h-12 w-full items-center justify-center rounded-xl bg-soft text-[15px] leading-none font-bold"
            >
              Terminar sesión
            </button>
          ) : null}
        </Sheet>
      ) : null}

      {flash ? (
        <div
          aria-hidden
          className="animate-flash pointer-events-none absolute inset-0 z-30"
          style={{ background: TONE.okBright }}
        />
      ) : null}
    </div>
  );
}

/** A panel from the bottom of the screen; tapping the scrim closes it. */
function Sheet({
  children,
  onClose,
}: {
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="absolute inset-0 z-20 flex flex-col bg-[rgb(31_29_27/0.44)]">
      <button
        type="button"
        aria-label="Cerrar"
        onClick={onClose}
        className="flex-1 cursor-default"
      />
      <div className="animate-sheet rounded-t-[28px] bg-surface px-5 pt-2.5 pb-8 shadow-float">
        <div className="mx-auto h-[5px] w-10 rounded-full bg-hairline" />
        <div className="mt-4">{children}</div>
      </div>
    </div>
  );
}

function countDone(logs: LogMap, exerciseId: string, sets: number): number {
  let n = 0;
  for (let i = 0; i < sets; i++) if (logs[keyOf(exerciseId, i)]) n++;
  return n;
}
