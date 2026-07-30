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
let flushing = false;
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

async function loadQueueState(): Promise<QueueState> {
  const rows = await getStore().getAll<StoredOp>("queue");
  rows.sort((a, b) => a.value.seq - b.value.seq);
  let state = EMPTY_QUEUE;
  for (const r of rows) state = enqueue(state, r.value.op);
  return state;
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

/* ── flush ───────────────────────────────────────────────────── */

async function doFlush(): Promise<SyncResponse | null> {
  const state = await loadQueueState();
  if (state.order.length === 0) return null;

  const { sessions, runLogs, mobilityLogs } = buildEnvelopes(state);
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
    return { ok: false, error: "not_authenticated" };
  }
  if (res.status === 400) {
    // Protocol mismatch (old client, new server). Keep the queue and
    // stop hammering — a reload brings matching code.
    return { ok: false, error: "bad_request" };
  }
  if (!res.ok) throw new Error(`sync ${res.status}`);

  const data = (await res.json()) as SyncResponse;
  const acked = data.ackedKeys ?? [];
  if (acked.length) {
    ackFlushed(state, acked); // keeps the reducer honest in tests
    for (const key of acked) await getStore().delete("queue", key);
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

  return data;
}

/**
 * Single-flight flush with backoff. Safe to call as often as you like —
 * concurrent calls collapse, failures reschedule themselves while the
 * tab is open, and the server is idempotent anyway.
 */
export async function flush(): Promise<SyncResponse | null> {
  if (typeof window === "undefined") return null;
  if (!navigator.onLine) return null;
  if (flushing) return null;
  flushing = true;
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
    flushing = false;
  }
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
