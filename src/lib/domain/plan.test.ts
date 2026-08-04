import { describe, expect, it } from "vitest";

import { DEFAULT_ENGINE_CONFIG, type LiftState } from "@/lib/engine";
import {
  resolveExercise,
  type ProgramExerciseRow,
} from "./plan";

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

const lifts = new Map([["sentadilla", squat]]);

/** A program_exercises row with only what the resolver reads filled in. */
function row(over: Partial<ProgramExerciseRow> = {}): ProgramExerciseRow {
  return {
    id: "ex-1",
    slot_id: "slot-1",
    exercise_id: null,
    position: 1,
    name: "Sentadilla",
    tag: "básico",
    sets: 4,
    rep_min: 5,
    rep_max: 6,
    rest_seconds: 180,
    is_primary: true,
    load_mode: "engine",
    lift_key: "sentadilla",
    fixed_weight_kg: null,
    notes: "",
    effort: "reps",
    superset_group: null,
    equipment: "barbell",
    created_at: "",
    ...over,
  } as ProgramExerciseRow;
}

describe("resolveExercise · load modes", () => {
  it("engine: the weight comes from the wave machinery, with the breakdown", () => {
    const r = resolveExercise(row(), 2, DEFAULT_ENGINE_CONFIG, lifts);
    // 120 × 0.80 = 96 → 95 on 2.5 kg steps.
    expect(r.weightKg).toBe(95);
    expect(r.breakdown?.waveFactor).toBe(0.8);
    expect(r.weightLabel).toBe("95 kg");
    expect(r.plates).not.toBeNull();
  });

  it("engine without a known lift resolves to no weight", () => {
    const r = resolveExercise(
      row({ lift_key: "peso-muerto" }),
      2,
      DEFAULT_ENGINE_CONFIG,
      lifts,
    );
    expect(r.weightKg).toBeNull();
    expect(r.breakdown).toBeNull();
    expect(r.weightLabel).toBe("—");
  });

  it("fixed: snaps to what the equipment can load — kettlebells are a set", () => {
    const base = row({
      is_primary: false,
      load_mode: "fixed",
      lift_key: null,
    });
    const barbell = resolveExercise(
      { ...base, fixed_weight_kg: 41, equipment: "barbell" },
      1,
      DEFAULT_ENGINE_CONFIG,
      lifts,
    );
    expect(barbell.weightKg).toBe(40);
    // 14 kg does not exist: nearest owned bell is 12 (ties go lighter).
    const kb = resolveExercise(
      { ...base, fixed_weight_kg: 14, equipment: "kettlebell" },
      1,
      DEFAULT_ENGINE_CONFIG,
      lifts,
    );
    expect(kb.weightKg).toBe(12);
    expect(kb.plates).toBeNull();
  });

  it("weighted_bodyweight: plate rounding on the belt load, '+' label", () => {
    const r = resolveExercise(
      row({
        is_primary: false,
        load_mode: "weighted_bodyweight",
        lift_key: null,
        fixed_weight_kg: 6,
        equipment: "dip_bars",
      }),
      1,
      DEFAULT_ENGINE_CONFIG,
      lifts,
    );
    expect(r.weightKg).toBe(5);
    expect(r.weightLabel).toBe("+5 kg");
  });
});

describe("resolveExercise · sets and the floor", () => {
  it("halves the sets on the deload week, keeping plannedSets", () => {
    const r = resolveExercise(row(), 4, DEFAULT_ENGINE_CONFIG, lifts);
    expect(r.sets).toBe(2);
    expect(r.plannedSets).toBe(4);
    expect(r.schemeLabel).toBe("2 × 5-6");
  });

  it("third strike on the primary: 2 sets at the 70 %-capped weight", () => {
    const struck = new Map([
      ["sentadilla", { ...squat, penalty: 0.1, failCount: 3 }],
    ]);
    const r = resolveExercise(row(), 3, DEFAULT_ENGINE_CONFIG, struck);
    expect(r.sets).toBe(2);
    expect(r.plannedSets).toBe(4);
    // Penalised RM 108 × 0.70 = 75.6 → 75 — never the 85 % step.
    expect(r.weightKg).toBe(75);
    expect(r.breakdown?.isForcedDeload).toBe(true);
    expect(r.weightKg!).toBeLessThanOrEqual(108 * 0.7);
  });

  it("the third strike never caps a non-primary row", () => {
    const struck = new Map([
      ["sentadilla", { ...squat, penalty: 0.1, failCount: 3 }],
    ]);
    const r = resolveExercise(
      row({ is_primary: false }),
      1,
      DEFAULT_ENGINE_CONFIG,
      struck,
    );
    expect(r.sets).toBe(4);
  });

  it("exposes the week's rep floor: one under on the 85 % week", () => {
    expect(resolveExercise(row(), 3, DEFAULT_ENGINE_CONFIG, lifts).repFloor).toBe(4);
    expect(resolveExercise(row(), 1, DEFAULT_ENGINE_CONFIG, lifts).repFloor).toBe(5);
  });
});
