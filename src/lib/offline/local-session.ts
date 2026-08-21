/**
 * The active session as the client knows it, persisted to IndexedDB so
 * a killed tab in a basement gym loses nothing. Pure reducers; the
 * runner renders straight from this state.
 */

import type { SessionKey } from "./queue";

export interface LocalSetEntry {
  value: number;
  missed: boolean;
  weightKg: number | null;
  rir: number | null;
  /** True when the value counts seconds (isometrics), not reps. */
  timed: boolean;
  loggedAt: string;
}

export interface LocalRestState {
  deadlineEpochMs: number;
  totalSeconds: number;
  label: string;
}

export interface LocalSessionState {
  localSessionId: string;
  /** Filled after the first flush; ≠ localSessionId if another device won. */
  canonicalSessionId: string | null;
  key: SessionKey;
  status: "in_progress" | "done" | "partial";
  startedAt: string;
  finishedAt: string | null;
  /** By "position:setIndex". */
  logs: Record<string, LocalSetEntry>;
  undoneFailures: Array<{ position: number; setIndex: number }>;
  rest: LocalRestState | null;
  /** Stepper overrides by exercise position — what the next set of each
      exercise goes on. Optional: states persisted before the field load
      fine, and the first logged set makes it redundant anyway. */
  weights?: Record<string, number>;
  /** Tombstones ("position:setIndex") for unlogged sets whose delete may
      not have flushed yet — server rows must not resurrect them. */
  removed?: string[];
}

const setKey = (position: number, setIndex: number) =>
  `${position}:${setIndex}`;

export function createLocalSession(
  localSessionId: string,
  key: SessionKey,
  startedAt: string,
): LocalSessionState {
  return {
    localSessionId,
    canonicalSessionId: null,
    key,
    status: "in_progress",
    startedAt,
    finishedAt: null,
    logs: {},
    undoneFailures: [],
    rest: null,
  };
}

export function recordLocalSet(
  state: LocalSessionState,
  input: {
    position: number;
    setIndex: number;
    value: number;
    missed: boolean;
    weightKg: number | null;
    rir: number | null;
    timed: boolean;
    loggedAt: string;
  },
): LocalSessionState {
  const k = setKey(input.position, input.setIndex);
  return {
    ...state,
    logs: {
      ...state.logs,
      [k]: {
        value: input.value,
        missed: input.missed,
        weightKg: input.weightKg,
        rir: input.rir,
        timed: input.timed,
        loggedAt: input.loggedAt,
      },
    },
    // A re-log cancels the tombstone: the set exists again.
    removed: state.removed?.filter((r) => r !== k),
  };
}

/** Remember the load the athlete moved the stepper to, per exercise, so
    a killed tab before the first set does not forget the change. */
export function setLocalWeight(
  state: LocalSessionState,
  position: number,
  weightKg: number,
): LocalSessionState {
  return {
    ...state,
    weights: { ...(state.weights ?? {}), [String(position)]: weightKg },
  };
}

/** Delete one logged set — the mirror of `recordLocalSet`. The key is
    tombstoned so a server row cannot resurrect it before the flush. */
export function removeLocalSet(
  state: LocalSessionState,
  position: number,
  setIndex: number,
): LocalSessionState {
  const k = setKey(position, setIndex);
  if (!(k in state.logs)) return state;
  const logs = { ...state.logs };
  delete logs[k];
  const removed = state.removed ?? [];
  return {
    ...state,
    logs,
    removed: removed.includes(k) ? removed : [...removed, k],
  };
}

export function undoLocalFailure(
  state: LocalSessionState,
  position: number,
  setIndex: number,
): LocalSessionState {
  const already = state.undoneFailures.some(
    (u) => u.position === position && u.setIndex === setIndex,
  );
  if (already) return state;
  return {
    ...state,
    undoneFailures: [...state.undoneFailures, { position, setIndex }],
  };
}

export function finishLocalSession(
  state: LocalSessionState,
  finishedAt: string,
  plannedSets: number,
): LocalSessionState {
  const doneSets = Object.keys(state.logs).length;
  return {
    ...state,
    status: plannedSets > 0 && doneSets < plannedSets ? "partial" : "done",
    finishedAt,
    rest: null,
  };
}

export function setLocalRest(
  state: LocalSessionState,
  rest: LocalRestState | null,
): LocalSessionState {
  return { ...state, rest };
}

/**
 * Merge what the server already has with what only this device knows.
 * Local entries win — they are newer by construction (anything the
 * server returned was flushed before the local write happened).
 */
export function mergeServerLogs(
  state: LocalSessionState,
  serverLogs: Array<{
    position: number;
    setIndex: number;
    reps: number | null;
    seconds: number | null;
    rir: number | null;
    weightKg: number | null;
    missedRange: boolean;
    loggedAt: string;
  }>,
): LocalSessionState {
  const logs = { ...state.logs };
  for (const l of serverLogs) {
    const k = setKey(l.position, l.setIndex);
    if (k in logs) continue; // local wins
    if (state.removed?.includes(k)) continue; // unlogged here, delete pending
    const value = l.reps ?? l.seconds;
    if (value == null) continue;
    logs[k] = {
      value,
      missed: l.missedRange,
      weightKg: l.weightKg,
      rir: l.rir,
      timed: l.reps == null && l.seconds != null,
      loggedAt: l.loggedAt,
    };
  }
  return { ...state, logs };
}
