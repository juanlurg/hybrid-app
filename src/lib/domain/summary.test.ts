import { describe, expect, it } from "vitest";

import { summarise } from "./summary";

const set = (reps: number, weight: number | null) => ({
  reps,
  seconds: null,
  weight_kg: weight,
  missed_range: false,
});

describe("summarise", () => {
  it("reports the load when every set went on the same one", () => {
    const s = summarise("a", "Sentadilla", true, 3, "engine", [
      set(5, 100),
      set(5, 100),
    ]);
    expect(s.weightLabel).toBe("100 kg");
    expect(s.repsLabel).toBe("5 · 5");
  });

  it("reports the spread when the athlete changed it mid-exercise", () => {
    const s = summarise("a", "Sentadilla", true, 3, "engine", [
      set(5, 100),
      set(4, 92.5),
      set(5, 92.5),
    ]);
    expect(s.weightLabel).toBe("92,5–100 kg");
  });

  it("says nothing when no set carries a load", () => {
    const s = summarise("a", "Dominadas", false, 3, "bodyweight", [
      set(8, null),
    ]);
    expect(s.weightLabel).toBe("corporal");
  });
});
