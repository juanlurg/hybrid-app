/**
 * Domain types for the weight engine.
 *
 * The engine is deliberately pure: no Supabase, no React, no dates from
 * `new Date()`. Everything it needs is passed in. That is what makes the
 * "cómo sale el peso de hoy" breakdown trustworthy — and testable.
 */

export type LiftKind = "lower" | "upper";

export type RegressionRule = "conservative" | "standard" | "aggressive";

export type LoadMode =
  | "engine" // weight comes from the wave × e1RM machinery
  | "fixed" // a number the athlete set by hand
  | "bodyweight" // no external load
  | "weighted_bodyweight" // added load on top of bodyweight (dominadas lastradas)
  | "rpe"; // "progresiv." — by feel, nothing to compute

/** Engine state for one tracked lift. Mirrors the `lifts` table. */
export interface LiftState {
  id: string;
  name: string;
  kind: LiftKind;
  /** Estimated 1RM in kg, before penalties. */
  e1rmKg: number;
  /** Accumulated regression penalty, 0–1 (0.05 = −5 %). */
  penalty: number;
  /** Consecutive range failures, capped at 3. */
  failCount: number;
  /** True when the engine froze the weight instead of cutting the RM. */
  hold: boolean;
  /** The frozen weight, in kg. Only meaningful when `hold` is true. */
  holdAtKg: number | null;
}

/** Program-level knobs that shape every calculation. */
export interface EngineConfig {
  /** Four multipliers, one per week of the cycle. Index = (week − 1) % 4. */
  wave: readonly number[];
  /** Cycle length in weeks. The last week of each cycle is the deload. */
  cycleWeeks: number;
  /** Added to the e1RM at the start of each new cycle — lower body. */
  incLowerKg: number;
  /** Same, upper body. */
  incUpperKg: number;
  /** Smallest weight step the athlete can actually load. */
  roundingKg: number;
  /** What happens when a set lands under the prescribed range. */
  regressionRule: RegressionRule;
  /** Bar weight in kg, for the plate breakdown. */
  barKg: number;
  /** Plate denominations available, in kg, descending. */
  platesKg: readonly number[];
  /** Halve the sets on the deload week. */
  autoDeload: boolean;
}

export const DEFAULT_WAVE = [0.75, 0.8, 0.85, 0.7] as const;

export const DEFAULT_PLATES = [25, 20, 15, 10, 5, 2.5, 1.25] as const;

export const DEFAULT_ENGINE_CONFIG: EngineConfig = {
  wave: DEFAULT_WAVE,
  cycleWeeks: 4,
  incLowerKg: 5,
  incUpperKg: 2.5,
  roundingKg: 2.5,
  regressionRule: "standard",
  barKg: 20,
  platesKg: DEFAULT_PLATES,
  autoDeload: true,
};

/** Full breakdown of how one working weight was arrived at. */
export interface WeightBreakdown {
  /** The number to put on the bar, in kg. */
  workingKg: number;
  /** e1RM before any penalty. */
  e1rmKg: number;
  /** Penalty fraction currently applied (0 when clean). */
  penalty: number;
  /** kg added because of completed cycles. */
  cycleBumpKg: number;
  /** Which cycle this week belongs to (1-based). */
  cycle: number;
  /** Wave multiplier used. */
  waveFactor: number;
  /** True when the wave step is the deload. */
  isDeload: boolean;
  /** True when the engine is repeating a frozen weight instead of computing. */
  isHeld: boolean;
  /** What the engine *would* have prescribed if the weight were not held. */
  uncappedKg: number;
  roundingKg: number;
}

/** The outcome of logging a set that missed the prescribed range. */
export interface RegressionOutcome {
  lift: LiftState;
  /** `hold` = repeat the same weight. `penalty` = cut the estimated RM. */
  action: "hold" | "penalty";
  /** Penalty fraction newly applied (0 for a hold). */
  penaltyApplied: number;
  /** Forced deload on the next session (third strike). */
  forcedDeload: boolean;
  title: string;
  detail: string;
}
