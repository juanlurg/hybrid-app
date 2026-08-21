import { describe, expect, it } from "vitest";

import {
  createLocalSession,
  finishLocalSession,
  mergeServerLogs,
  recordLocalSet,
  removeLocalSet,
  setLocalRest,
  undoLocalFailure,
} from "./local-session";
import type { SessionKey } from "./queue";

const KEY: SessionKey = {
  phaseId: "ph-1",
  slotId: "slot-1",
  scheduledOn: "2026-09-14",
  week: 1,
  dayIndex: 0,
  sessionType: "strength",
  title: "Fuerza A",
};

const base = () => createLocalSession("loc-1", KEY, "2026-09-14T18:00:00Z");

describe("local session reducers", () => {
  it("removeLocalSet deletes exactly one entry and tolerates absence", () => {
    let s = recordLocalSet(base(), {
      position: 1,
      setIndex: 0,
      value: 6,
      missed: false,
      weightKg: 90,
      rir: null,
      timed: false,
      loggedAt: "t1",
    });
    s = recordLocalSet(s, {
      position: 1,
      setIndex: 1,
      value: 6,
      missed: false,
      weightKg: 90,
      rir: null,
      timed: false,
      loggedAt: "t2",
    });
    const removed = removeLocalSet(s, 1, 0);
    expect(Object.keys(removed.logs)).toEqual(["1:1"]);
    // Removing a set that is not there is a no-op, not an error.
    expect(removeLocalSet(removed, 1, 0)).toBe(removed);
  });

  it("re-recording a set overwrites it", () => {
    let s = recordLocalSet(base(), {
      position: 1,
      setIndex: 0,
      value: 6,
      missed: false,
      weightKg: 90,
      rir: null,
      timed: false,
      loggedAt: "t1",
    });
    s = recordLocalSet(s, {
      position: 1,
      setIndex: 0,
      value: 4,
      missed: true,
      weightKg: 90,
      rir: 0,
      timed: false,
      loggedAt: "t2",
    });
    expect(Object.keys(s.logs)).toHaveLength(1);
    expect(s.logs["1:0"].value).toBe(4);
    expect(s.logs["1:0"].missed).toBe(true);
  });

  it("finishing decides done vs partial from planned sets", () => {
    let s = base();
    s = recordLocalSet(s, {
      position: 1, setIndex: 0, value: 5, missed: false,
      weightKg: 90, rir: null, timed: false, loggedAt: "t",
    });
    expect(finishLocalSession(s, "t2", 4).status).toBe("partial");
    expect(finishLocalSession(s, "t2", 1).status).toBe("done");
  });

  it("finishing clears the rest timer", () => {
    let s = setLocalRest(base(), {
      deadlineEpochMs: 1000, totalSeconds: 180, label: "x",
    });
    s = finishLocalSession(s, "t", 0);
    expect(s.rest).toBeNull();
  });

  it("undo is recorded once, no matter how many taps", () => {
    let s = undoLocalFailure(base(), 1, 0);
    s = undoLocalFailure(s, 1, 0);
    expect(s.undoneFailures).toHaveLength(1);
  });

  it("merging server logs never overwrites a local entry", () => {
    let s = recordLocalSet(base(), {
      position: 1, setIndex: 0, value: 4, missed: true,
      weightKg: 90, rir: null, timed: false, loggedAt: "t-local",
    });
    s = mergeServerLogs(s, [
      { position: 1, setIndex: 0, reps: 6, seconds: null, rir: null,
        weightKg: 90, missedRange: false, loggedAt: "t-server" },
      { position: 1, setIndex: 1, reps: 5, seconds: null, rir: 2,
        weightKg: 90, missedRange: false, loggedAt: "t-server" },
    ]);
    expect(s.logs["1:0"].value).toBe(4); // local wins
    expect(s.logs["1:1"].value).toBe(5); // server fills the gap
    expect(s.logs["1:1"].rir).toBe(2);
  });

  it("timed server logs come back as seconds", () => {
    const s = mergeServerLogs(base(), [
      { position: 5, setIndex: 0, reps: null, seconds: 30, rir: null,
        weightKg: null, missedRange: false, loggedAt: "t" },
    ]);
    expect(s.logs["5:0"].timed).toBe(true);
    expect(s.logs["5:0"].value).toBe(30);
  });
});
