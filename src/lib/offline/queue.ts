/**
 * The write-ahead queue. EVERY write the runner makes — online or not —
 * goes through here first; a syncer flushes envelopes to /api/sync when
 * there is network. One write path means online and offline cannot
 * diverge.
 *
 * Pure reducers over a plain state object; persistence is the caller's
 * problem (an IndexedDB adapter in the app, a Map in the tests).
 */

export interface SessionKey {
  phaseId: string;
  slotId: string;
  scheduledOn: string;
  week: number;
  dayIndex: number;
  sessionType: string;
  title: string;
}

export type QueueOp =
  | {
      kind: "session_start";
      localSessionId: string;
      key: SessionKey;
      startedAt: string;
    }
  | {
      kind: "set_log";
      localSessionId: string;
      programExerciseId: string;
      liftKey: string | null;
      exerciseName: string;
      position: number;
      setIndex: number;
      reps: number | null;
      seconds: number | null;
      rir: number | null;
      weightKg: number | null;
      loggedAt: string;
    }
  | {
      kind: "engine_undo";
      localSessionId: string;
      position: number;
      setIndex: number;
    }
  | {
      kind: "set_unlog";
      localSessionId: string;
      position: number;
      setIndex: number;
    }
  | {
      kind: "session_finish";
      localSessionId: string;
      finishedAt: string;
      /** Optional session note from the explicit finish — "aquíleo molesto". */
      notes?: string | null;
    }
  | {
      kind: "run_log";
      key: SessionKey;
      prescription: string;
      durationMinutes: number | null;
      distanceKm: number | null;
      avgHr: number | null;
      decouplingPct: number | null;
      /** RPE 1-10 — absent on ops queued before the field existed. */
      perceivedEffort?: number | null;
      notes: string;
      loggedAt: string;
    }
  | {
      kind: "mobility_log";
      performedOn: string;
      completedSlugs: string[];
      totalItems: number;
      loggedAt: string;
    };

/**
 * Natural idempotency key. Re-logging the same set REPLACES the queued
 * op (local last-write-wins); the server upserts on the same key.
 */
export function opKey(op: QueueOp): string {
  switch (op.kind) {
    case "session_start":
      return `${op.localSessionId}:start`;
    case "set_log":
      return `${op.localSessionId}:set:${op.position}:${op.setIndex}`;
    // DELIBERATELY the same key as set_log: exactly one op per set
    // survives in the queue, so a log and its unlog can never travel in
    // one envelope and the server needs no ordering rules between them.
    case "set_unlog":
      return `${op.localSessionId}:set:${op.position}:${op.setIndex}`;
    case "engine_undo":
      return `${op.localSessionId}:undo:${op.position}:${op.setIndex}`;
    case "session_finish":
      return `${op.localSessionId}:finish`;
    case "run_log":
      return `run:${op.key.scheduledOn}:${op.key.slotId}`;
    case "mobility_log":
      return `mob:${op.performedOn}`;
  }
}

export interface QueueState {
  ops: Record<string, QueueOp>;
  /** Insertion order of keys; a replaced op keeps its original slot. */
  order: string[];
}

export const EMPTY_QUEUE: QueueState = { ops: {}, order: [] };

export function enqueue(state: QueueState, op: QueueOp): QueueState {
  const key = opKey(op);
  const exists = key in state.ops;
  return {
    ops: { ...state.ops, [key]: op },
    order: exists ? state.order : [...state.order, key],
  };
}

/** Drop the ops the server acknowledged. Unknown keys are ignored. */
export function ackFlushed(state: QueueState, keys: string[]): QueueState {
  const gone = new Set(keys);
  const ops: Record<string, QueueOp> = {};
  const order = state.order.filter((k) => !gone.has(k));
  for (const k of order) ops[k] = state.ops[k];
  return { ops, order };
}

export function pendingCount(state: QueueState): number {
  return state.order.length;
}

/* ── envelopes: what /api/sync receives ──────────────────────── */

export interface SessionEnvelope {
  localSessionId: string;
  /** Null when the start op was already acked and no local session survives. */
  key: SessionKey | null;
  startedAt: string | null;
  sets: Array<{
    programExerciseId: string;
    liftKey: string | null;
    exerciseName: string;
    position: number;
    setIndex: number;
    reps: number | null;
    seconds: number | null;
    rir: number | null;
    weightKg: number | null;
    loggedAt: string;
  }>;
  undoneFailures: Array<{ position: number; setIndex: number }>;
  /** Sets to delete server-side — the athlete unmarked them. */
  unlogs: Array<{ position: number; setIndex: number }>;
  finish: { finishedAt: string; notes?: string | null } | null;
  /** Queue keys this envelope covers — acked together on success. */
  opKeys: string[];
}

export interface RunLogEnvelope {
  key: SessionKey;
  prescription: string;
  durationMinutes: number | null;
  distanceKm: number | null;
  avgHr: number | null;
  decouplingPct: number | null;
  perceivedEffort?: number | null;
  notes: string;
  opKey: string;
}

export interface MobilityLogEnvelope {
  performedOn: string;
  completedSlugs: string[];
  totalItems: number;
  opKey: string;
}

export interface SyncRequest {
  protocolVersion: 1;
  deviceId: string;
  sessions: SessionEnvelope[];
  runLogs: RunLogEnvelope[];
  mobilityLogs: MobilityLogEnvelope[];
}

export interface SyncSessionResult {
  localSessionId: string;
  canonicalSessionId: string;
  setsApplied: number;
  status: string;
  banner: { title: string; detail: string; tone: "warn" | "fail" } | null;
  /** True when the session belongs to an archived programme: history
      lands, but only the active programme moves the engine. */
  engineSkipped?: boolean;
}

export interface SyncResponse {
  ok: boolean;
  error?: string;
  results?: SyncSessionResult[];
  ackedKeys?: string[];
  /** Envelopes that failed: transient ones stay queued, the rest are dropped and surfaced. */
  failures?: Array<{ opKeys: string[]; reason: string; transient: boolean }>;
}

/**
 * Group the queue into envelopes, one per local session plus the
 * standalone run/mobility logs. Pure, so the grouping is testable
 * without touching IndexedDB.
 *
 * `sessionKeys` fills the key for envelopes whose session_start op was
 * already acked — the common online flow. Without it (or a miss) the
 * key ships null and the server resolves the session by its id.
 */
export function buildEnvelopes(
  state: QueueState,
  sessionKeys?: Map<string, SessionKey>,
): {
  sessions: SessionEnvelope[];
  runLogs: RunLogEnvelope[];
  mobilityLogs: MobilityLogEnvelope[];
} {
  const bySession = new Map<string, SessionEnvelope>();
  const runLogs: RunLogEnvelope[] = [];
  const mobilityLogs: MobilityLogEnvelope[] = [];

  const envelopeFor = (
    localSessionId: string,
    key: SessionKey | null,
  ): SessionEnvelope => {
    let env = bySession.get(localSessionId);
    if (!env) {
      env = {
        localSessionId,
        key: key ?? sessionKeys?.get(localSessionId) ?? null,
        startedAt: null,
        sets: [],
        undoneFailures: [],
        unlogs: [],
        finish: null,
        opKeys: [],
      };
      bySession.set(localSessionId, env);
    }
    return env;
  };

  for (const k of state.order) {
    const op = state.ops[k];
    switch (op.kind) {
      case "session_start": {
        const env = envelopeFor(op.localSessionId, op.key);
        env.key = op.key;
        env.startedAt = op.startedAt;
        env.opKeys.push(k);
        break;
      }
      case "set_log": {
        const env = envelopeFor(op.localSessionId, null);
        env.sets.push({
          programExerciseId: op.programExerciseId,
          liftKey: op.liftKey,
          exerciseName: op.exerciseName,
          position: op.position,
          setIndex: op.setIndex,
          reps: op.reps,
          seconds: op.seconds,
          rir: op.rir,
          weightKg: op.weightKg,
          loggedAt: op.loggedAt,
        });
        env.opKeys.push(k);
        break;
      }
      case "engine_undo": {
        const env = envelopeFor(op.localSessionId, null);
        env.undoneFailures.push({
          position: op.position,
          setIndex: op.setIndex,
        });
        env.opKeys.push(k);
        break;
      }
      case "set_unlog": {
        const env = envelopeFor(op.localSessionId, null);
        env.unlogs.push({ position: op.position, setIndex: op.setIndex });
        env.opKeys.push(k);
        break;
      }
      case "session_finish": {
        const env = envelopeFor(op.localSessionId, null);
        env.finish = { finishedAt: op.finishedAt, notes: op.notes ?? null };
        env.opKeys.push(k);
        break;
      }
      case "run_log":
        runLogs.push({
          key: op.key,
          prescription: op.prescription,
          durationMinutes: op.durationMinutes,
          distanceKm: op.distanceKm,
          avgHr: op.avgHr,
          decouplingPct: op.decouplingPct,
          perceivedEffort: op.perceivedEffort ?? null,
          notes: op.notes,
          opKey: k,
        });
        break;
      case "mobility_log":
        mobilityLogs.push({
          performedOn: op.performedOn,
          completedSlugs: op.completedSlugs,
          totalItems: op.totalItems,
          opKey: k,
        });
        break;
    }
  }

  // Sets inside an envelope flush in logging order.
  for (const env of bySession.values()) {
    env.sets.sort((a, b) => a.loggedAt.localeCompare(b.loggedAt));
  }

  return { sessions: [...bySession.values()], runLogs, mobilityLogs };
}
