import { describe, expect, it } from "vitest";

import {
  cycleBump,
  DEFAULT_ENGINE_CONFIG,
  isDeloadWeek,
  loadableWeight,
  setsForWeek,
  waveFactor,
  workingWeight,
  type LiftState,
} from ".";
import { phaseEngineConfig, type PhaseRow } from "@/lib/domain/plan";

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

/** A phase row with only what the engine reads filled in. */
function phase(over: Partial<PhaseRow> = {}): PhaseRow {
  return {
    id: "phase-1",
    program_id: "prog-1",
    key: "F2",
    name: "Hipertrofia / Fuerza",
    emphasis: "",
    position: 3,
    weeks: 12,
    starts_on: "2026-09-14",
    notes: "",
    created_at: "",
    wave: null,
    cycle_weeks: null,
    progression_mode: "wave",
    pct_of_rm: null,
    auto_deload: null,
    ...over,
  } as PhaseRow;
}

describe("phaseEngineConfig · wave mode", () => {
  it("starts every phase at wave[0] — F2 week 1 is 75 %, not the deload", () => {
    // The bug this pins down: on absolute weeks, F2 week 1 was absolute
    // week 8 → wave[(8-1)%4] = 0.70 with halved sets. Phase-local weeks
    // make week 1 of any phase the first step of the wave.
    const cfg = phaseEngineConfig(DEFAULT_ENGINE_CONFIG, phase());
    expect(waveFactor(1, cfg)).toBe(0.75);
    expect(isDeloadWeek(1, cfg)).toBe(false);
    // 120 × 0.75 = 90.
    expect(workingWeight(squat, 1, cfg).workingKg).toBe(90);
  });

  it("deloads on the phase's own week 4, 8, 12", () => {
    const cfg = phaseEngineConfig(DEFAULT_ENGINE_CONFIG, phase());
    expect(isDeloadWeek(4, cfg)).toBe(true);
    expect(isDeloadWeek(8, cfg)).toBe(true);
    expect(isDeloadWeek(5, cfg)).toBe(false);
  });

  it("bumps cycles inside the phase: F2 week 5 starts cycle 2 (+5 kg lower)", () => {
    const cfg = phaseEngineConfig(DEFAULT_ENGINE_CONFIG, phase());
    expect(cycleBump("lower", 5, cfg)).toBe(5);
    // (120 + 5) × 0.75 = 93.75 → 95: the half-step rounds up.
    expect(workingWeight(squat, 5, cfg).workingKg).toBe(95);
  });

  it("takes the phase's own wave when it has one (F0 caps at 80 %)", () => {
    const cfg = phaseEngineConfig(
      DEFAULT_ENGINE_CONFIG,
      phase({ key: "F0", wave: [0.75, 0.8, 0.8, 0.7] }),
    );
    expect(waveFactor(3, cfg)).toBe(0.8);
  });
});

describe("phaseEngineConfig · fixed_pct mode", () => {
  const f3 = phase({ key: "F3", progression_mode: "fixed_pct", pct_of_rm: 0.8 });

  it("every week is the fixed % — no wave, no bumps, no deload", () => {
    const cfg = phaseEngineConfig(DEFAULT_ENGINE_CONFIG, f3);
    for (const week of [1, 2, 4, 7]) {
      expect(waveFactor(week, cfg)).toBe(0.8);
      expect(cycleBump("lower", week, cfg)).toBe(0);
      expect(isDeloadWeek(week, cfg)).toBe(false);
    }
    // 120 × 0.80 = 96 → 95 with 2.5 kg steps, every single week.
    expect(workingWeight(squat, 1, cfg).workingKg).toBe(95);
    expect(workingWeight(squat, 7, cfg).workingKg).toBe(95);
  });

  it("never halves sets: fixed-% phases have no auto deload", () => {
    const cfg = phaseEngineConfig(DEFAULT_ENGINE_CONFIG, f3);
    expect(setsForWeek(4, 4, cfg)).toBe(4);
  });

  it("a hold still short-circuits the maths", () => {
    const cfg = phaseEngineConfig(DEFAULT_ENGINE_CONFIG, f3);
    const held: LiftState = { ...squat, hold: true, holdAtKg: 90 };
    expect(workingWeight(held, 3, cfg).workingKg).toBe(90);
    expect(workingWeight(held, 3, cfg).isHeld).toBe(true);
  });
});

describe("phaseEngineConfig · auto_deload override", () => {
  it("maps program_phases.auto_deload onto deloadOverride", () => {
    expect(
      phaseEngineConfig(DEFAULT_ENGINE_CONFIG, phase()).deloadOverride,
    ).toBeNull();
    expect(
      phaseEngineConfig(DEFAULT_ENGINE_CONFIG, phase({ auto_deload: true }))
        .deloadOverride,
    ).toBe(true);
    expect(
      phaseEngineConfig(DEFAULT_ENGINE_CONFIG, phase({ auto_deload: false }))
        .deloadOverride,
    ).toBe(false);
  });

  it("F4: fixed 80 % with auto_deload=true — sets halve every 4th week, the % stays", () => {
    const f4 = phase({
      key: "F4",
      progression_mode: "fixed_pct",
      pct_of_rm: 0.8,
      auto_deload: true,
    });
    const cfg = phaseEngineConfig(DEFAULT_ENGINE_CONFIG, f4);
    expect(isDeloadWeek(4, cfg)).toBe(true);
    expect(isDeloadWeek(8, cfg)).toBe(true);
    expect(isDeloadWeek(5, cfg)).toBe(false);
    expect(setsForWeek(3, 4, cfg)).toBe(2);
    // waveFactor stays pctOfRm on the deload week: 120 × 0.80 → 95.
    expect(waveFactor(4, cfg)).toBe(0.8);
    expect(workingWeight(squat, 4, cfg).workingKg).toBe(95);
  });

  it("a wave phase with auto_deload=false never deloads", () => {
    const cfg = phaseEngineConfig(
      DEFAULT_ENGINE_CONFIG,
      phase({ auto_deload: false }),
    );
    expect(isDeloadWeek(4, cfg)).toBe(false);
    expect(setsForWeek(4, 4, cfg)).toBe(4);
    // Week 4 still prescribes the wave's own 70 % step.
    expect(waveFactor(4, cfg)).toBe(0.7);
  });
});

describe("beginner-scale loads · why the 10K plan asks for 1.25 kg rounding", () => {
  // A 35 kg squat is a real starting RM (plan-10k-base). At the default
  // 2.5 kg rounding the wave loses its resolution: two different steps
  // prescribe the same bar. Halving the rounding gives it back.
  const beginner: LiftState = { ...squat, e1rmKg: 35 };
  const f1 = phase({ key: "F1", wave: [0.7, 0.75, 0.8, 0.65], cycle_weeks: 4 });

  it("collapses weeks 2 and 3 onto the same weight at 2.5 kg", () => {
    const cfg = phaseEngineConfig(DEFAULT_ENGINE_CONFIG, f1);
    // 35 × 0.75 = 26.25 and 35 × 0.80 = 28 both round to 27.5.
    expect(workingWeight(beginner, 2, cfg).workingKg).toBe(27.5);
    expect(workingWeight(beginner, 3, cfg).workingKg).toBe(27.5);
  });

  it("separates them at 1.25 kg", () => {
    const cfg = phaseEngineConfig(
      { ...DEFAULT_ENGINE_CONFIG, roundingKg: 1.25 },
      f1,
    );
    expect(workingWeight(beginner, 2, cfg).workingKg).toBe(26.25);
    expect(workingWeight(beginner, 3, cfg).workingKg).toBe(27.5);
  });

  it("never drops below the bar: every step of the wave is rackable", () => {
    const cfg = phaseEngineConfig(
      { ...DEFAULT_ENGINE_CONFIG, roundingKg: 1.25 },
      f1,
    );
    for (const week of [1, 2, 3, 4]) {
      expect(workingWeight(beginner, week, cfg).workingKg).toBeGreaterThanOrEqual(
        cfg.barKg,
      );
    }
  });
});

describe("loadableWeight", () => {
  const cfg = DEFAULT_ENGINE_CONFIG; // rounding 2.5, dumbbell 2.5, pulley 5, KBs 12/16

  it("barbell rounds to the plate step", () => {
    expect(loadableWeight(61, "barbell", cfg)).toBe(60);
  });

  it("dumbbell rounds per dumbbell, not per plate pair", () => {
    expect(loadableWeight(23.7, "dumbbell", cfg)).toBe(22.5);
  });

  it("pulley rounds to the stack's pin spacing", () => {
    expect(loadableWeight(23, "pulley", cfg)).toBe(25);
  });

  it("kettlebell snaps to a bell that exists — 14 kg is not a thing", () => {
    expect(loadableWeight(14, "kettlebell", cfg)).toBe(12); // tie → lighter
    expect(loadableWeight(15, "kettlebell", cfg)).toBe(16);
    expect(loadableWeight(30, "kettlebell", cfg)).toBe(16); // heaviest owned
  });

  it("bodyweight-style equipment passes the number through", () => {
    expect(loadableWeight(12.5, "bodyweight", cfg)).toBe(12.5);
    expect(loadableWeight(12.5, "dip_bars", cfg)).toBe(12.5);
  });

  it("unknown equipment falls back to the profile rounding", () => {
    expect(loadableWeight(61, null, cfg)).toBe(60);
  });
});
