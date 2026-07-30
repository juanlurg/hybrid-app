/**
 * The flush loop between the IndexedDB queue and /api/sync. Fire-and-
 * forget from the UI's point of view: enqueue returns immediately, the
 * flush happens when there is network — milliseconds later online,
 * whenever the connection returns offline.
 *
 * Triggers: every enqueue, the `online` event, the tab becoming
 * visible, and app start. Never Background Sync — iOS does not do it.
 */

import { openOfflineStore, type OfflineStore } from "./db";
import {
  ackFlushed,
  buildEnvelopes,
  EMPTY_QUEUE,
  enqueue,
  opKey,
  type QueueOp,
  type QueueState,
  type SessionKey,
  type SyncResponse,
} from "./queue";
import type { LocalSessionState } from "./local-session";

interface StoredOp {
  seq: number;
  op: QueueOp;
}

type FlushListener = (response: SyncResponse) => void;

let store: OfflineStore | null = null;
let seq = 0;
let inFlight: Promise<SyncResponse | null> | null = null;
let follower: Promise<SyncResponse | null> | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let retryDelayMs = 2000;
let triggersAttached = false;
const listeners = new Set<FlushListener>();

function getStore(): OfflineStore {
  store ??= openOfflineStore();
  return store;
}

/** Overridable for tests. */
export function setOfflineStoreForTesting(s: OfflineStore | null) {
  store = s;
}

async function deviceId(): Promise<string> {
  const s = getStore();
  const existing = await s.get<string>("meta", "deviceId");
  if (existing) return existing;
  const id = crypto.randomUUID();
  await s.put("meta", "deviceId", id);
  return id;
}

async function loadQueueState(): Promise<{
  state: QueueState;
  /** seq of each op at snapshot time — the ack must not delete an op
      overwritten while its old value was in flight. */
  seqByKey: Map<string, number>;
}> {
  const rows = await getStore().getAll<StoredOp>("queue");
  rows.sort((a, b) => a.value.seq - b.value.seq);
  let state = EMPTY_QUEUE;
  const seqByKey = new Map<string, number>();
  for (const r of rows) {
    state = enqueue(state, r.value.op);
    seqByKey.set(opKey(r.value.op), r.value.seq);
  }
  return { state, seqByKey };
}

/** Delete an acked/dropped op only if it was not overwritten mid-flight. */
async function deleteIfUnchanged(
  key: string,
  seqByKey: Map<string, number>,
): Promise<void> {
  const current = await getStore().get<StoredOp>("queue", key);
  if (!current || current.seq !== seqByKey.get(key)) return;
  await getStore().delete("queue", key);
}

/* ── local sessions ──────────────────────────────────────────── */

export async function putLocalSession(s: LocalSessionState): Promise<void> {
  await getStore().put("localSessions", s.localSessionId, s);
}

export async function getLocalSession(
  id: string,
): Promise<LocalSessionState | undefined> {
  return getStore().get<LocalSessionState>("localSessions", id);
}

export async function deleteLocalSession(id: string): Promise<void> {
  await getStore().delete("localSessions", id);
}

export async function allLocalSessions(): Promise<LocalSessionState[]> {
  const rows = await getStore().getAll<LocalSessionState>("localSessions");
  return rows.map((r) => r.value);
}

/* ── queue ───────────────────────────────────────────────────── */

export async function enqueueOp(op: QueueOp): Promise<void> {
  const stored: StoredOp = { seq: Date.now() * 1000 + (seq++ % 1000), op };
  await getStore().put("queue", opKey(op), stored);
}

export async function pendingOps(): Promise<number> {
  return (await getStore().getAll("queue")).length;
}

export function onFlushResult(cb: FlushListener): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/* ── sync visibility — what the indicator on Hoy reads ───────── */

export interface SyncAlerts {
  /** The server refused the whole flush (401/409/400). */
  blocked: { at: string; error: string } | null;
  /** Ops the server rejected permanently — dropped and surfaced. */
  failure: { at: string; reasons: string[]; opCount: number } | null;
}

async function noteBlocked(error: string): Promise<void> {
  await getStore().put("meta", "lastSyncBlocked", {
    at: new Date().toISOString(),
    error,
  });
}

export async function readSyncAlerts(): Promise<SyncAlerts> {
  const s = getStore();
  return {
    blocked:
      (await s.get<SyncAlerts["blocked"]>("meta", "lastSyncBlocked")) ?? null,
    failure:
      (await s.get<SyncAlerts["failure"]>("meta", "lastSyncFailure")) ?? null,
  };
}

export async function clearSyncFailure(): Promise<void> {
  await getStore().delete("meta", "lastSyncFailure");
}

/** Epoch ms of the oldest queued op — `seq` encodes Date.now()·1000. */
export async function oldestPendingAt(): Promise<number | null> {
  const rows = await getStore().getAll<StoredOp>("queue");
  if (!rows.length) return null;
  return Math.floor(Math.min(...rows.map((r) => r.value.seq)) / 1000);
}

/* ── flush ───────────────────────────────────────────────────── */

async function doFlush(): Promise<SyncResponse | null> {
  const { state, seqByKey } = await loadQueueState();
  if (state.order.length === 0) return null;

  // The session_start op is acked and deleted first in the normal
  // online flow; the persisted local session still holds the key.
  const locals = await allLocalSessions();
  const sessionKeys = new Map<string, SessionKey>(
    locals.map((s) => [s.localSessionId, s.key]),
  );
  const { sessions, runLogs, mobilityLogs } = buildEnvelopes(state, sessionKeys);
  const body = {
    protocolVersion: 1 as const,
    deviceId: await deviceId(),
    sessions,
    runLogs,
    mobilityLogs,
  };

  const res = await fetch("/api/sync", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    credentials: "same-origin",
  });

  if (res.status === 401) {
    // Cookie expired mid-gym. The queue survives; the next authenticated
    // navigation refreshes the session and the flush retries.
    await noteBlocked("not_authenticated");
    return { ok: false, error: "not_authenticated" };
  }
  if (res.status === 409) {
    // Signed in but no active programme — nothing to sync against
    // until one is activated from Ajustes → Datos.
    await noteBlocked("no_active_program");
    return { ok: false, error: "no_active_program" };
  }
  if (res.status === 400) {
    // Protocol mismatch (old client, new server). Keep the queue and
    // stop hammering — a reload brings matching code.
    await noteBlocked("bad_request");
    return { ok: false, error: "bad_request" };
  }
  if (!res.ok) throw new Error(`sync ${res.status}`);
  await getStore().delete("meta", "lastSyncBlocked");

  const data = (await res.json()) as SyncResponse;
  const acked = data.ackedKeys ?? [];
  if (acked.length) {
    ackFlushed(state, acked); // keeps the reducer honest in tests
    for (const key of acked) await deleteIfUnchanged(key, seqByKey);
  }

  // Non-transient failures will never land no matter how often we
  // retry: surface them (the meta summary feeds the sync indicator)
  // and stop resending them.
  const fatal = (data.failures ?? []).filter((f) => !f.transient);
  if (fatal.length) {
    await getStore().put("meta", "lastSyncFailure", {
      at: new Date().toISOString(),
      reasons: fatal.map((f) => f.reason),
      opCount: fatal.reduce((n, f) => n + f.opKeys.length, 0),
    });
    for (const f of fatal) {
      for (const key of f.opKeys) await deleteIfUnchanged(key, seqByKey);
    }
  }

  // Reconcile canonical session ids the server may have chosen.
  for (const r of data.results ?? []) {
    const local = await getLocalSession(r.localSessionId);
    if (local && local.canonicalSessionId !== r.canonicalSessionId) {
      await putLocalSession({
        ...local,
        canonicalSessionId: r.canonicalSessionId,
      });
    }
  }

  // Prune local sessions that finished, flushed fully and aged out —
  // they exist to survive a mid-session crash, not forever. Recent ones
  // stay so the offline summary still renders right after a finish.
  const remaining = await getStore().getAll<StoredOp>("queue");
  const withPendingOps = new Set(
    remaining
      .map((r) => r.value.op)
      .flatMap((op) => ("localSessionId" in op ? [op.localSessionId] : [])),
  );
  for (const s of locals) {
    if (s.status === "in_progress" || !s.finishedAt) continue;
    if (withPendingOps.has(s.localSessionId)) continue;
    if (Date.now() - new Date(s.finishedAt).getTime() < 24 * 3600 * 1000) {
      continue;
    }
    await deleteLocalSession(s.localSessionId);
  }

  return data;
}

async function runFlush(): Promise<SyncResponse | null> {
  try {
    const response = await doFlush();
    retryDelayMs = 2000;
    if (response) for (const cb of listeners) cb(response);
    return response;
  } catch {
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = setTimeout(() => void flush(), retryDelayMs);
    retryDelayMs = Math.min(retryDelayMs * 2, 60_000);
    return null;
  } finally {
    inFlight = null;
  }
}

/**
 * Coalescing flush with backoff. Safe to call as often as you like.
 * Callers arriving mid-flight share ONE follow-up run whose doFlush
 * re-reads the queue — so awaiting flush() after an enqueue always
 * resolves with a response that covered your op. (The old single-flight
 * version returned null here, which made finish() report "sin conexión"
 * while fully online.)
 */
export function flush(): Promise<SyncResponse | null> {
  if (typeof window === "undefined") return Promise.resolve(null);
  if (!navigator.onLine) return Promise.resolve(null);
  if (inFlight) {
    follower ??= inFlight.then(
      () => flush(),
      () => flush(),
    );
    return follower;
  }
  follower = null;
  inFlight = runFlush();
  return inFlight;
}

/** Enqueue and try to land it right away. The op survives either way. */
export async function enqueueAndFlush(op: QueueOp): Promise<void> {
  await enqueueOp(op);
  void flush();
}

/** Idempotent: wire the flush to the events that mean "network may be back". */
export function attachSyncTriggers(): void {
  if (triggersAttached || typeof window === "undefined") return;
  triggersAttached = true;
  window.addEventListener("online", () => void flush());
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void flush();
  });
  void flush();
}
