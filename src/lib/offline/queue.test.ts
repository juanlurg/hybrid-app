import { describe, expect, it } from "vitest";

import {
  ackFlushed,
  buildEnvelopes,
  EMPTY_QUEUE,
  enqueue,
  opKey,
  pendingCount,
  type QueueOp,
  type SessionKey,
} from "./queue";

const KEY: SessionKey = {
  phaseId: "ph-1",
  slotId: "slot-1",
  scheduledOn: "2026-09-14",
  week: 1,
  dayIndex: 0,
  sessionType: "strength",
  title: "Fuerza A",
};

const start: QueueOp = {
  kind: "session_start",
  localSessionId: "loc-1",
  key: KEY,
  startedAt: "2026-09-14T18:00:00Z",
};

function set(setIndex: number, reps: number, loggedAt: string): QueueOp {
  return {
    kind: "set_log",
    localSessionId: "loc-1",
    programExerciseId: "ex-1",
    liftKey: "sentadilla",
    exerciseName: "Sentadilla",
    position: 1,
    setIndex,
    reps,
    seconds: null,
    rir: null,
    weightKg: 90,
    loggedAt,
  };
}

const unlog = (setIndex: number): QueueOp => ({
  kind: "set_unlog",
  localSessionId: "loc-1",
  position: 1,
  setIndex,
});

describe("queue reducers", () => {
  it("re-logging the same set replaces the op — local last write wins", () => {
    let q = enqueue(EMPTY_QUEUE, set(0, 6, "t1"));
    q = enqueue(q, set(0, 4, "t2"));
    expect(pendingCount(q)).toBe(1);
    const op = q.ops[opKey(set(0, 0, ""))];
    expect(op.kind === "set_log" && op.reps).toBe(4);
  });

  it("an unlog replaces an unflushed log under the same key — the server never sees the set", () => {
    let q = enqueue(EMPTY_QUEUE, set(0, 6, "t1"));
    q = enqueue(q, unlog(0));
    expect(pendingCount(q)).toBe(1);
    expect(q.ops[opKey(unlog(0))].kind).toBe("set_unlog");
    const { sessions } = buildEnvelopes(q);
    expect(sessions[0].sets).toHaveLength(0);
    expect(sessions[0].unlogs).toEqual([{ position: 1, setIndex: 0 }]);
  });

  it("a re-log replaces a queued unlog — one op per set, ever", () => {
    let q = enqueue(EMPTY_QUEUE, unlog(0));
    q = enqueue(q, set(0, 5, "t2"));
    expect(pendingCount(q)).toBe(1);
    const { sessions } = buildEnvelopes(q);
    expect(sessions[0].unlogs).toHaveLength(0);
    expect(sessions[0].sets).toHaveLength(1);
  });

  it("ack removes exactly what the server confirmed", () => {
    let q = enqueue(EMPTY_QUEUE, start);
    q = enqueue(q, set(0, 6, "t1"));
    q = enqueue(q, set(1, 6, "t2"));
    q = ackFlushed(q, [opKey(start), opKey(set(0, 0, ""))]);
    expect(pendingCount(q)).toBe(1);
    expect(q.order).toEqual(["loc-1:set:1:1"]);
  });

  it("mobility and run ops key on their natural identity", () => {
    const mob: QueueOp = {
      kind: "mobility_log",
      performedOn: "2026-09-14",
      completedSlugs: ["a"],
      totalItems: 9,
      loggedAt: "t",
    };
    expect(opKey(mob)).toBe("mob:2026-09-14");
    const run: QueueOp = {
      kind: "run_log",
      key: KEY,
      prescription: "45' Z2",
      durationMinutes: 45,
      distanceKm: null,
      avgHr: null,
      decouplingPct: null,
      notes: "",
      loggedAt: "t",
    };
    expect(opKey(run)).toBe("run:2026-09-14:slot-1");
  });
});

describe("buildEnvelopes", () => {
  it("groups a whole session into one envelope, sets in logging order", () => {
    let q = enqueue(EMPTY_QUEUE, start);
    q = enqueue(q, set(1, 5, "2026-09-14T18:10:00Z"));
    q = enqueue(q, set(0, 6, "2026-09-14T18:05:00Z"));
    q = enqueue(q, {
      kind: "engine_undo",
      localSessionId: "loc-1",
      position: 1,
      setIndex: 0,
    });
    q = enqueue(q, {
      kind: "session_finish",
      localSessionId: "loc-1",
      finishedAt: "2026-09-14T19:00:00Z",
    });

    const { sessions, runLogs, mobilityLogs } = buildEnvelopes(q);
    expect(sessions).toHaveLength(1);
    expect(runLogs).toHaveLength(0);
    expect(mobilityLogs).toHaveLength(0);

    const env = sessions[0];
    expect(env.key).toEqual(KEY);
    expect(env.sets.map((s) => s.setIndex)).toEqual([0, 1]);
    expect(env.undoneFailures).toEqual([{ position: 1, setIndex: 0 }]);
    expect(env.finish?.finishedAt).toBe("2026-09-14T19:00:00Z");
    // The ack round-trip: every queued key rides the envelope.
    expect(env.opKeys).toHaveLength(5);
  });

  it("sets without a start hydrate the key from the local-session map", () => {
    const q = enqueue(EMPTY_QUEUE, set(2, 5, "t"));
    const { sessions } = buildEnvelopes(q, new Map([["loc-1", KEY]]));
    expect(sessions).toHaveLength(1);
    expect(sessions[0].startedAt).toBeNull();
    expect(sessions[0].sets).toHaveLength(1);
    expect(sessions[0].key).toEqual(KEY);
  });

  it("sets without a start and no local session ship a null key, never a placeholder", () => {
    const q = enqueue(EMPTY_QUEUE, set(2, 5, "t"));
    const { sessions } = buildEnvelopes(q);
    expect(sessions).toHaveLength(1);
    expect(sessions[0].key).toBeNull();
  });

  it("run and mobility logs travel as standalone envelopes", () => {
    let q = enqueue(EMPTY_QUEUE, {
      kind: "run_log",
      key: KEY,
      prescription: "45' Z2",
      durationMinutes: 45,
      distanceKm: 8.2,
      avgHr: 145,
      decouplingPct: null,
      notes: "",
      loggedAt: "t",
    });
    q = enqueue(q, {
      kind: "mobility_log",
      performedOn: "2026-09-14",
      completedSlugs: ["a", "b"],
      totalItems: 9,
      loggedAt: "t",
    });
    const { sessions, runLogs, mobilityLogs } = buildEnvelopes(q);
    expect(sessions).toHaveLength(0);
    expect(runLogs[0].distanceKm).toBe(8.2);
    expect(mobilityLogs[0].completedSlugs).toEqual(["a", "b"]);
  });
});
