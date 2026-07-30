import { describe, expect, it } from "vitest";

import { DEFAULT_ENGINE_CONFIG } from ".";
import {
  doubleProgression,
  equipmentIncrementKg,
  type AccessoryProgressionInput,
} from "./progression";

const cfg = DEFAULT_ENGINE_CONFIG; // rounding 2.5 · dumbbell 2.5 · pulley 5 · KBs 12/16

function input(
  over: Partial<AccessoryProgressionInput> = {},
): AccessoryProgressionInput {
  return {
    equipment: "barbell",
    effort: "reps",
    repMax: 10,
    plannedSets: 3,
    currentWeightKg: 40,
    logs: [
      { reps: 10, seconds: null, rir: null },
      { reps: 10, seconds: null, rir: null },
      { reps: 10, seconds: null, rir: null },
    ],
    ...over,
  };
}

describe("doubleProgression", () => {
  it("all sets at the top of the range → the equipment's increment", () => {
    const out = doubleProgression(input(), cfg);
    expect(out.advance).toBe(true);
    expect(out.nextWeightKg).toBe(42.5);
  });

  it("one set under the top → the weight repeats", () => {
    const out = doubleProgression(
      input({
        logs: [
          { reps: 10, seconds: null, rir: null },
          { reps: 9, seconds: null, rir: null },
          { reps: 10, seconds: null, rir: null },
        ],
      }),
      cfg,
    );
    expect(out.advance).toBe(false);
    expect(out.nextWeightKg).toBe(40);
  });

  it("RIR under the minimum blocks the jump — nunca fallo", () => {
    const out = doubleProgression(
      input({
        logs: [
          { reps: 10, seconds: null, rir: 2 },
          { reps: 10, seconds: null, rir: 0 },
          { reps: 10, seconds: null, rir: 1 },
        ],
      }),
      cfg,
    );
    expect(out.advance).toBe(false);
  });

  it("fewer logged sets than prescribed → incomplete, no jump", () => {
    const out = doubleProgression(
      input({ logs: input().logs.slice(0, 2) }),
      cfg,
    );
    expect(out.advance).toBe(false);
  });

  it("dumbbells jump by the dumbbell step", () => {
    const out = doubleProgression(
      input({ equipment: "dumbbell", currentWeightKg: 22.5 }),
      cfg,
    );
    expect(out.nextWeightKg).toBe(25);
  });

  it("pulley jumps one pin", () => {
    const out = doubleProgression(
      input({ equipment: "pulley", currentWeightKg: 60 }),
      cfg,
    );
    expect(out.nextWeightKg).toBe(65);
  });

  it("kettlebell jumps to the next bell that exists", () => {
    const out = doubleProgression(
      input({ equipment: "kettlebell", currentWeightKg: 12 }),
      cfg,
    );
    expect(out.nextWeightKg).toBe(16);
  });

  it("heaviest kettlebell owned → hold, there is nothing to jump to", () => {
    const out = doubleProgression(
      input({ equipment: "kettlebell", currentWeightKg: 16 }),
      cfg,
    );
    expect(out.advance).toBe(false);
  });

  it("timed holds progress on seconds", () => {
    const out = doubleProgression(
      input({
        equipment: "pulley",
        effort: "seconds",
        repMax: 30,
        currentWeightKg: 20,
        logs: [
          { reps: null, seconds: 30, rir: null },
          { reps: null, seconds: 32, rir: null },
          { reps: null, seconds: 30, rir: null },
        ],
      }),
      cfg,
    );
    expect(out.advance).toBe(true);
    expect(out.nextWeightKg).toBe(25);
  });

  it("AMRAP and unloaded work never auto-progress in kilos", () => {
    expect(doubleProgression(input({ effort: "amrap" }), cfg).advance).toBe(false);
    expect(
      doubleProgression(input({ currentWeightKg: null }), cfg).advance,
    ).toBe(false);
    expect(
      doubleProgression(input({ equipment: "bodyweight" }), cfg).advance,
    ).toBe(false);
  });
});

describe("equipmentIncrementKg", () => {
  it("maps material to its real-world jump", () => {
    expect(equipmentIncrementKg("barbell", cfg)).toBe(2.5);
    expect(equipmentIncrementKg("dumbbell", cfg)).toBe(2.5);
    expect(equipmentIncrementKg("pulley", cfg)).toBe(5);
    expect(equipmentIncrementKg("bodyweight", cfg)).toBe(0);
  });
});
