import { describe, expect, it } from "vitest";

import {
  DEFAULT_ENGINE_CONFIG,
  cycleBump,
  cycleOf,
  epley1RM,
  epleyLoad,
  formatPlates,
  formatWeight,
  isDeloadWeek,
  isRangeFailure,
  plateBreakdown,
  projectLift,
  regressionLadder,
  registerCleanSession,
  registerFailure,
  revertFailure,
  roundToStep,
  setsForWeek,
  tonnage,
  warmupSets,
  waveFactor,
  workingWeight,
  workingWeightKg,
  type EngineConfig,
  type LiftState,
} from ".";

const hipThrust: LiftState = {
  id: "hipthrust",
  name: "Hip thrust",
  kind: "lower",
  e1rmKg: 150,
  penalty: 0,
  failCount: 0,
  hold: false,
  holdAtKg: null,
};

const bench: LiftState = {
  ...hipThrust,
  id: "banca",
  name: "Press banca",
  kind: "upper",
  e1rmKg: 92.5,
};

describe("rounding", () => {
  it("snaps to the loadable step", () => {
    expect(roundToStep(101.3, 2.5)).toBe(102.5);
    expect(roundToStep(100.9, 2.5)).toBe(100);
    expect(roundToStep(101.3, 1.25)).toBe(101.25);
    expect(roundToStep(101.3, 5)).toBe(100);
  });

  it("falls back to 2.5 kg on a nonsense step", () => {
    expect(roundToStep(101.3, 0)).toBe(102.5);
  });

  it("formats with a Spanish decimal comma", () => {
    expect(formatWeight(92.5)).toBe("92,5");
    expect(formatWeight(120)).toBe("120");
    expect(formatWeight(101.25)).toBe("101,25");
  });
});

describe("cycles and waves", () => {
  it("maps weeks to cycles", () => {
    expect(cycleOf(1)).toBe(1);
    expect(cycleOf(4)).toBe(1);
    expect(cycleOf(5)).toBe(2);
    expect(cycleOf(12)).toBe(3);
  });

  it("walks the 75 / 80 / 85 / 70 wave", () => {
    expect(waveFactor(1, DEFAULT_ENGINE_CONFIG)).toBe(0.75);
    expect(waveFactor(2, DEFAULT_ENGINE_CONFIG)).toBe(0.8);
    expect(waveFactor(3, DEFAULT_ENGINE_CONFIG)).toBe(0.85);
    expect(waveFactor(4, DEFAULT_ENGINE_CONFIG)).toBe(0.7);
    expect(waveFactor(5, DEFAULT_ENGINE_CONFIG)).toBe(0.75);
  });

  it("puts the deload on the last week of every cycle", () => {
    expect(isDeloadWeek(4, DEFAULT_ENGINE_CONFIG)).toBe(true);
    expect(isDeloadWeek(8, DEFAULT_ENGINE_CONFIG)).toBe(true);
    expect(isDeloadWeek(3, DEFAULT_ENGINE_CONFIG)).toBe(false);
  });

  it("adds the cycle bump once per completed cycle", () => {
    expect(cycleBump("lower", 1, DEFAULT_ENGINE_CONFIG)).toBe(0);
    expect(cycleBump("lower", 5, DEFAULT_ENGINE_CONFIG)).toBe(5);
    expect(cycleBump("lower", 9, DEFAULT_ENGINE_CONFIG)).toBe(10);
    expect(cycleBump("upper", 9, DEFAULT_ENGINE_CONFIG)).toBe(5);
  });

  it("halves the sets on the deload when auto-deload is on", () => {
    expect(setsForWeek(4, 3, DEFAULT_ENGINE_CONFIG)).toBe(4);
    expect(setsForWeek(4, 4, DEFAULT_ENGINE_CONFIG)).toBe(2);
    expect(setsForWeek(3, 4, DEFAULT_ENGINE_CONFIG)).toBe(2);
    expect(
      setsForWeek(4, 4, { ...DEFAULT_ENGINE_CONFIG, autoDeload: false }),
    ).toBe(4);
  });
});

describe("working weight", () => {
  it("computes the wave weight for the block", () => {
    // 150 × 0.75 = 112.5 ; × 0.80 = 120 ; × 0.85 = 127.5 ; × 0.70 = 105
    expect(workingWeightKg(hipThrust, 1)).toBe(112.5);
    expect(workingWeightKg(hipThrust, 2)).toBe(120);
    expect(workingWeightKg(hipThrust, 3)).toBe(127.5);
    expect(workingWeightKg(hipThrust, 4)).toBe(105);
  });

  it("carries the cycle bump into the next cycle", () => {
    // (150 + 5) × 0.80 = 124 → rounds to 125 on a 2.5 step
    expect(workingWeightKg(hipThrust, 6)).toBe(125);
  });

  it("rounds upper-body lifts on the same step", () => {
    // 92.5 × 0.80 = 74
    expect(workingWeightKg(bench, 2)).toBe(75);
  });

  it("repeats a held weight instead of climbing", () => {
    const held: LiftState = { ...hipThrust, hold: true, holdAtKg: 120 };
    const b = workingWeight(held, 3);
    expect(b.workingKg).toBe(120);
    expect(b.isHeld).toBe(true);
    // The breakdown still shows what it would have been.
    expect(b.uncappedKg).toBe(127.5);
  });

  it("recomputes from the penalised RM", () => {
    const hurt: LiftState = { ...hipThrust, penalty: 0.05, failCount: 2 };
    // 150 × 0.95 = 142.5 ; × 0.85 = 121.125 → 120
    expect(workingWeightKg(hurt, 3)).toBe(120);
  });

  it("exposes every term of the derivation", () => {
    const b = workingWeight(hipThrust, 6);
    expect(b).toMatchObject({
      e1rmKg: 150,
      penalty: 0,
      cycleBumpKg: 5,
      cycle: 2,
      waveFactor: 0.8,
      isDeload: false,
      isHeld: false,
      roundingKg: 2.5,
    });
  });

  it("projects a block ignoring the hold", () => {
    const held: LiftState = { ...hipThrust, hold: true, holdAtKg: 100 };
    const series = projectLift(held, 12);
    expect(series).toHaveLength(12);
    expect(series[0]).toBe(112.5);
    expect(series.every((v) => v !== 100)).toBe(true);
  });
});

describe("regression", () => {
  it("uses the ladder for each rule", () => {
    expect(regressionLadder("conservative")).toEqual([0, 0, 0.05]);
    expect(regressionLadder("standard")).toEqual([0, 0.05, 0.1]);
    expect(regressionLadder("aggressive")).toEqual([0.05, 0.1, 0.15]);
  });

  it("flags a set under the range", () => {
    expect(isRangeFailure(4, 5)).toBe(true);
    expect(isRangeFailure(5, 5)).toBe(false);
    expect(isRangeFailure(6, 5)).toBe(false);
  });

  it("freezes the weight on the first miss (standard)", () => {
    const out = registerFailure(hipThrust, 127.5, 3);
    expect(out.action).toBe("hold");
    expect(out.lift.hold).toBe(true);
    expect(out.lift.holdAtKg).toBe(127.5);
    expect(out.lift.penalty).toBe(0);
    expect(out.lift.failCount).toBe(1);
    expect(out.detail).toContain("127,5 kg");
    expect(out.detail).toContain("5 %");
  });

  it("cuts the RM on the second miss and clears the hold", () => {
    const first = registerFailure(hipThrust, 127.5, 3).lift;
    const second = registerFailure(first, 127.5, 3);
    expect(second.action).toBe("penalty");
    expect(second.penaltyApplied).toBe(0.05);
    expect(second.lift.hold).toBe(false);
    expect(second.lift.penalty).toBe(0.05);
    expect(second.forcedDeload).toBe(false);
  });

  it("forces a deload on the third miss", () => {
    let lift = hipThrust;
    let out = registerFailure(lift, 127.5, 3);
    lift = out.lift;
    out = registerFailure(lift, 120, 3);
    lift = out.lift;
    out = registerFailure(lift, 115, 3);
    expect(out.lift.failCount).toBe(3);
    expect(out.lift.penalty).toBe(0.1);
    expect(out.forcedDeload).toBe(true);
    expect(out.detail).toContain("descarga forzada");
  });

  it("cuts immediately under the aggressive rule", () => {
    const cfg: EngineConfig = {
      ...DEFAULT_ENGINE_CONFIG,
      regressionRule: "aggressive",
    };
    const out = registerFailure(hipThrust, 127.5, 3, cfg);
    expect(out.action).toBe("penalty");
    expect(out.lift.penalty).toBe(0.05);
  });

  it("never cuts on the first two misses under the conservative rule", () => {
    const cfg: EngineConfig = {
      ...DEFAULT_ENGINE_CONFIG,
      regressionRule: "conservative",
    };
    const a = registerFailure(hipThrust, 127.5, 3, cfg);
    expect(a.action).toBe("hold");
    const b = registerFailure(a.lift, 127.5, 3, cfg);
    expect(b.action).toBe("hold");
    const c = registerFailure(b.lift, 127.5, 3, cfg);
    expect(c.action).toBe("penalty");
    expect(c.lift.penalty).toBe(0.05);
  });

  it("undoes the last failure", () => {
    const failed = registerFailure(hipThrust, 127.5, 3).lift;
    expect(revertFailure(failed)).toMatchObject({
      failCount: 0,
      hold: false,
      holdAtKg: null,
      penalty: 0,
    });
  });

  it("clears the counter after a clean session but keeps the penalty", () => {
    const hurt: LiftState = {
      ...hipThrust,
      failCount: 2,
      penalty: 0.05,
      hold: false,
      holdAtKg: null,
    };
    const clean = registerCleanSession(hurt);
    expect(clean.failCount).toBe(0);
    expect(clean.penalty).toBe(0.05);
  });

  it("is a no-op on an already clean lift", () => {
    expect(registerCleanSession(hipThrust)).toBe(hipThrust);
  });
});

describe("1RM estimation", () => {
  it("uses Epley", () => {
    // 100 × (1 + 5/30) = 116.67
    expect(epley1RM(100, 5)).toBeCloseTo(116.67, 2);
    expect(epley1RM(140, 1)).toBe(140);
    expect(epley1RM(100, 0)).toBe(0);
  });

  it("inverts cleanly", () => {
    expect(epleyLoad(epley1RM(100, 5), 5)).toBeCloseTo(100, 1);
  });
});

describe("plates", () => {
  it("breaks a load down per side", () => {
    // 127.5 kg = 20 kg bar + 53.75 kg a side.
    const load = plateBreakdown(127.5);
    expect(load.perSide).toEqual([25, 25, 2.5, 1.25]);
    expect(load.perSide.reduce((a, b) => a + b, 0)).toBe(53.75);
    expect(load.remainderKg).toBe(0);
    expect(formatPlates(load)).toBe("25 · 25 · 2,5 · 1,25");
  });

  it("cannot reach a 2.5 kg step without 1.25 kg plates", () => {
    // The reason 1.25s are in the default kit: a 2.5 kg rounding step
    // needs a 1.25 kg plate a side, otherwise the bar rounds to 5 kg.
    const load = plateBreakdown(127.5, {
      barKg: 20,
      platesKg: [25, 20, 15, 10, 5, 2.5],
    });
    expect(load.remainderKg).toBe(1.25);
  });

  it("reports the empty bar", () => {
    const load = plateBreakdown(20);
    expect(load.barOnly).toBe(true);
    expect(formatPlates(load)).toBe("barra 20");
  });

  it("leaves a remainder when the plates cannot reach the target", () => {
    const load = plateBreakdown(21.5, {
      barKg: 20,
      platesKg: [25, 20, 15, 10, 5, 2.5],
    });
    expect(load.perSide).toEqual([]);
    expect(load.remainderKg).toBeCloseTo(0.75, 2);
  });

  it("respects a lighter bar", () => {
    // 60 kg on a 15 kg bar = 22.5 a side; the kit tops out at 20 + 2.5 short.
    const load = plateBreakdown(60, { barKg: 15, platesKg: [25, 20, 10, 5] });
    expect(load.perSide).toEqual([20]);
    expect(load.remainderKg).toBe(2.5);
  });
});

describe("warm-up", () => {
  it("ramps from the bar to just under the work weight", () => {
    const sets = warmupSets(120);
    expect(sets[0].weightKg).toBe(20);
    expect(sets.map((s) => s.weightKg)).toEqual([20, 47.5, 72.5, 95]);
    expect(sets.every((s) => s.weightKg < 120)).toBe(true);
  });

  it("skips the ramp when the work set is the bar", () => {
    expect(warmupSets(20)).toEqual([]);
  });
});

describe("tonnage", () => {
  it("sums weight × reps and ignores blanks", () => {
    expect(
      tonnage([
        { weightKg: 100, reps: 5 },
        { weightKg: 100, reps: 5 },
        { weightKg: null, reps: 12 },
        { weightKg: 60, reps: null },
      ]),
    ).toBe(1000);
  });
});
