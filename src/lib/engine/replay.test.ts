import { describe, expect, it } from "vitest";

import { DEFAULT_ENGINE_CONFIG, registerFailure, type LiftState } from ".";
import {
  failDedupKey,
  preSessionLiftState,
  replayEngine,
  type ReplayInput,
} from "./replay";

const squat: LiftState = {
  id: "l1",
  name: "Sentadilla",
  kind: "lower",
  e1rmKg: 120,
  penalty: 0,
  failCount: 0,
  hold: false,
  holdAtKg: null,
};

const PRIMARY = {
  programExerciseId: "ex-1",
  liftKey: "sentadilla",
  repMin: 5,
  sets: 4,
};

function log(setIndex: number, reps: number, weightKg = 90) {
  return {
    programExerciseId: "ex-1",
    position: 1,
    setIndex,
    reps,
    seconds: null,
    weightKg,
  };
}

function input(over: Partial<ReplayInput> = {}): ReplayInput {
  return {
    sessionId: "s-1",
    lift: squat,
    primary: PRIMARY,
    logs: [],
    undone: [],
    week: 1,
    config: DEFAULT_ENGINE_CONFIG,
    ...over,
  };
}

describe("replayEngine", () => {
  it("a clean session releases nothing it does not hold", () => {
    const r = replayEngine(
      input({ logs: [log(0, 6), log(1, 6), log(2, 5), log(3, 5)] }),
    );
    expect(r.clean).toBe(true);
    expect(r.events).toHaveLength(0);
    expect(r.banner).toBeNull();
    expect(r.lift).toEqual(squat);
  });

  it("first miss = hold, exactly like registerFailure says", () => {
    const r = replayEngine(input({ logs: [log(0, 4)] }));
    const direct = registerFailure(squat, 90, 1, DEFAULT_ENGINE_CONFIG);
    expect(r.events).toHaveLength(1);
    expect(r.events[0].kind).toBe("fail_hold");
    expect(r.events[0].title).toBe(direct.title);
    expect(r.events[0].detail).toBe(direct.detail);
    expect(r.lift).toEqual(direct.lift);
    expect(r.banner?.tone).toBe("warn");
  });

  it("two misses walk the ladder: hold, then −5 %", () => {
    const r = replayEngine(input({ logs: [log(0, 4), log(1, 3)] }));
    expect(r.events.map((e) => e.kind)).toEqual(["fail_hold", "fail_penalty"]);
    expect(r.lift?.penalty).toBe(0.05);
    expect(r.lift?.failCount).toBe(2);
    expect(r.banner?.tone).toBe("fail");
  });

  it("an undone miss is recorded but never applied", () => {
    const r = replayEngine(
      input({
        logs: [log(0, 4), log(1, 3)],
        undone: [{ position: 1, setIndex: 0 }],
      }),
    );
    // Both events exist (history tells the truth)…
    expect(r.events).toHaveLength(2);
    expect(r.events[0].undone).toBe(true);
    // …but the fold only applied the second, from the ORIGINAL state.
    expect(r.lift?.failCount).toBe(1);
    expect(r.lift?.hold).toBe(true);
  });

  it("is idempotent: replaying the replay changes nothing", () => {
    const logs = [log(0, 4), log(1, 5), log(2, 3)];
    const once = replayEngine(input({ logs }));
    const twice = replayEngine(input({ logs }));
    expect(twice.lift).toEqual(once.lift);
    expect(twice.events.map((e) => e.dedupKey)).toEqual(
      once.events.map((e) => e.dedupKey),
    );
  });

  it("dedup keys are stable per session/set", () => {
    expect(failDedupKey("s-1", 1, 2)).toBe("s-1:fail:1:2");
    const r = replayEngine(input({ logs: [log(2, 4)] }));
    expect(r.events[0].dedupKey).toBe("s-1:fail:1:2");
    expect(r.cleanDedupKey).toBe("s-1:clean");
  });

  it("a clean full session clears an incoming hold", () => {
    const held: LiftState = { ...squat, hold: true, holdAtKg: 90, failCount: 1 };
    const r = replayEngine(
      input({ lift: held, logs: [log(0, 5), log(1, 5), log(2, 5), log(3, 5)] }),
    );
    expect(r.clean).toBe(true);
    expect(r.lift?.hold).toBe(false);
    expect(r.lift?.failCount).toBe(0);
  });

  it("no primary or no lift → nothing to do", () => {
    expect(replayEngine(input({ primary: null })).lift).toBeNull();
    expect(replayEngine(input({ lift: null })).events).toHaveLength(0);
  });
});

describe("preSessionLiftState", () => {
  it("with no events, the current row is the starting point", () => {
    expect(preSessionLiftState(squat, [])).toEqual(squat);
  });

  it("rewinds to the earliest event's `previous` state", () => {
    const mutated: LiftState = {
      ...squat,
      penalty: 0.05,
      failCount: 2,
      hold: false,
    };
    const events = [
      {
        createdAt: "2026-07-30T10:05:00Z",
        previous: { e1rmKg: 120, penalty: 0, failCount: 1, hold: true, holdAtKg: 90 },
      },
      {
        createdAt: "2026-07-30T10:00:00Z",
        previous: { e1rmKg: 120, penalty: 0, failCount: 0, hold: false, holdAtKg: null },
      },
    ];
    const rewound = preSessionLiftState(mutated, events);
    expect(rewound.failCount).toBe(0);
    expect(rewound.penalty).toBe(0);
    expect(rewound.hold).toBe(false);
  });
});
