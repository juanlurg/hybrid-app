import { describe, expect, it } from "vitest";

import {
  buildEnvelopes,
  EMPTY_QUEUE,
  enqueue,
  type QueueOp,
  type SessionKey,
  type SyncRequest,
} from "./queue";
import { syncRequestSchema } from "./sync-schema";

/**
 * The contract test the placeholder-key bug proved was missing: every
 * envelope buildEnvelopes can emit must parse against the exact schema
 * /api/sync rejects with. Real UUIDs — the server demands them.
 */

const LOCAL_ID = "6f8a2c34-1d5e-4b6f-9a30-8e2b7c1d4a55";
const KEY: SessionKey = {
  phaseId: "0b54f4a2-97cc-4f6e-8d2a-64f0f7f9c2f1",
  slotId: "d4a1b2c3-5e6f-4a7b-8c9d-0e1f2a3b4c5d",
  scheduledOn: "2026-09-14",
  week: 1,
  dayIndex: 0,
  sessionType: "strength",
  title: "Fuerza A",
};

function request(
  parts: ReturnType<typeof buildEnvelopes>,
): SyncRequest {
  return {
    protocolVersion: 1,
    deviceId: "device-1",
    ...parts,
  };
}

const start: QueueOp = {
  kind: "session_start",
  localSessionId: LOCAL_ID,
  key: KEY,
  startedAt: "2026-09-14T18:00:00Z",
};

const set: QueueOp = {
  kind: "set_log",
  localSessionId: LOCAL_ID,
  programExerciseId: "a1b2c3d4-e5f6-4a0b-8c1d-2e3f4a5b6c7d",
  liftKey: "sentadilla",
  exerciseName: "Sentadilla",
  position: 1,
  setIndex: 0,
  reps: 6,
  seconds: null,
  rir: 2,
  weightKg: 90,
  loggedAt: "2026-09-14T18:05:00Z",
};

describe("buildEnvelopes output vs the /api/sync schema", () => {
  it("a full session envelope parses", () => {
    let q = enqueue(EMPTY_QUEUE, start);
    q = enqueue(q, set);
    q = enqueue(q, {
      kind: "session_finish",
      localSessionId: LOCAL_ID,
      finishedAt: "2026-09-14T19:00:00Z",
    });
    const parsed = syncRequestSchema.safeParse(request(buildEnvelopes(q)));
    expect(parsed.success).toBe(true);
  });

  it("an orphan-sets envelope with a hydrated key parses", () => {
    const q = enqueue(EMPTY_QUEUE, set);
    const parts = buildEnvelopes(q, new Map([[LOCAL_ID, KEY]]));
    const parsed = syncRequestSchema.safeParse(request(parts));
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.sessions[0].key).toEqual(KEY);
  });

  it("an orphan-sets envelope with a null key parses — the 400 that poisoned the queue", () => {
    const q = enqueue(EMPTY_QUEUE, set);
    const parsed = syncRequestSchema.safeParse(request(buildEnvelopes(q)));
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.sessions[0].key).toBeNull();
  });

  it("the legacy placeholder key from pre-hydration clients coerces to null", () => {
    const q = enqueue(EMPTY_QUEUE, set);
    const parts = buildEnvelopes(q);
    parts.sessions[0].key = {
      phaseId: "",
      slotId: "",
      scheduledOn: "",
      week: 1,
      dayIndex: 0,
      sessionType: "strength",
      title: "",
    };
    const parsed = syncRequestSchema.safeParse(request(parts));
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.sessions[0].key).toBeNull();
  });

  it("run and mobility envelopes parse", () => {
    let q = enqueue(EMPTY_QUEUE, {
      kind: "run_log",
      key: KEY,
      prescription: "45' Z2",
      durationMinutes: 45,
      distanceKm: 8.2,
      avgHr: 145,
      decouplingPct: 3.5,
      notes: "cómodo",
      loggedAt: "t",
    });
    q = enqueue(q, {
      kind: "mobility_log",
      performedOn: "2026-09-14",
      completedSlugs: ["gato-camello"],
      totalItems: 9,
      loggedAt: "t",
    });
    const parsed = syncRequestSchema.safeParse(request(buildEnvelopes(q)));
    expect(parsed.success).toBe(true);
  });
});
