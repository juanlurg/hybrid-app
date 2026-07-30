/**
 * The weight engine.
 *
 * Every working weight in the app comes out of `workingWeight()`. Nothing
 * else is allowed to invent a number — not the UI, not the AI editor. That
 * single rule is what makes the plan auditable: the athlete can always ask
 * "cómo sale el peso de hoy" and get the same five lines back.
 */

import {
  DEFAULT_ENGINE_CONFIG,
  type EngineConfig,
  type Equipment,
  type LiftKind,
  type LiftState,
  type RegressionOutcome,
  type RegressionRule,
  type WeightBreakdown,
} from "./types";

export * from "./types";

/* ── numbers ─────────────────────────────────────────────────── */

/** Round to the nearest loadable step. */
export function roundToStep(weightKg: number, stepKg: number): number {
  if (!Number.isFinite(weightKg)) return 0;
  const step = stepKg > 0 ? stepKg : 2.5;
  return round2(Math.round(weightKg / step) * step);
}

/** Kill floating-point dust without losing 1.25 kg increments. */
export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

const KG_PER_LB = 0.45359237;

export function kgToLb(kg: number): number {
  return round2(kg / KG_PER_LB);
}

export function lbToKg(lb: number): number {
  return round2(lb * KG_PER_LB);
}

/** Spanish decimal comma, trailing zeros trimmed. 92.5 → "92,5". */
export function formatWeight(kg: number): string {
  return round2(kg).toString().replace(".", ",");
}

/* ── cycles and waves ────────────────────────────────────────── */

/** Which cycle a 1-based week belongs to. Week 5 with 4-week cycles → 2. */
export function cycleOf(week: number, cycleWeeks = 4): number {
  const len = cycleWeeks > 0 ? cycleWeeks : 4;
  return Math.floor((Math.max(1, week) - 1) / len) + 1;
}

/** Position inside the cycle, 0-based. Week 5 → 0. */
export function weekInCycle(week: number, cycleWeeks = 4): number {
  const len = cycleWeeks > 0 ? cycleWeeks : 4;
  return (Math.max(1, week) - 1) % len;
}

/** The multiplier for a given week: the wave step, or the fixed %. */
export function waveFactor(week: number, config: EngineConfig): number {
  if (config.progressionMode === "fixed_pct") {
    return config.pctOfRm ?? 0.8;
  }
  const wave = config.wave.length ? config.wave : DEFAULT_ENGINE_CONFIG.wave;
  return wave[weekInCycle(week, config.cycleWeeks) % wave.length];
}

/** The last week of every cycle is the deload. Fixed-% blocks never deload. */
export function isDeloadWeek(week: number, config: EngineConfig): boolean {
  if (config.progressionMode === "fixed_pct") return false;
  return weekInCycle(week, config.cycleWeeks) === config.cycleWeeks - 1;
}

/** kg added to the e1RM because earlier cycles closed cleanly. */
export function cycleBump(
  kind: LiftKind,
  week: number,
  config: EngineConfig,
): number {
  if (config.progressionMode === "fixed_pct") return 0;
  const inc = kind === "lower" ? config.incLowerKg : config.incUpperKg;
  return round2((cycleOf(week, config.cycleWeeks) - 1) * inc);
}

/* ── the working weight ──────────────────────────────────────── */

/**
 * Full derivation of the weight for `lift` on `week`.
 *
 * `hold` is a CAP, not a floor: after a first range failure the wave may
 * not climb past the missed weight, but a week the wave prescribes less
 * (the deload, the first weeks of the next cycle) keeps its own number.
 * The failed weight repeats exactly when the wave reaches it again —
 * repeating a just-failed top weight on the 70 % deload week inverted
 * the deload's whole purpose.
 */
export function workingWeight(
  lift: LiftState,
  week: number,
  config: EngineConfig = DEFAULT_ENGINE_CONFIG,
): WeightBreakdown {
  const factor = waveFactor(week, config);
  const bump = cycleBump(lift.kind, week, config);
  const penalised = lift.e1rmKg * (1 - lift.penalty);
  const uncapped = roundToStep((penalised + bump) * factor, config.roundingKg);
  const heldKg =
    lift.hold && lift.holdAtKg != null && lift.holdAtKg > 0
      ? round2(lift.holdAtKg)
      : null;
  const held = heldKg != null && heldKg <= uncapped;

  return {
    workingKg: held ? heldKg : uncapped,
    e1rmKg: round2(lift.e1rmKg),
    penalty: lift.penalty,
    cycleBumpKg: bump,
    cycle:
      config.progressionMode === "fixed_pct"
        ? 1
        : cycleOf(week, config.cycleWeeks),
    waveFactor: factor,
    isDeload: isDeloadWeek(week, config),
    isHeld: held,
    uncappedKg: uncapped,
    roundingKg: config.roundingKg,
  };
}

/** Convenience: just the number. */
export function workingWeightKg(
  lift: LiftState,
  week: number,
  config: EngineConfig = DEFAULT_ENGINE_CONFIG,
): number {
  return workingWeight(lift, week, config).workingKg;
}

/**
 * Projection of a lift across a block, ignoring `hold` (which only ever
 * applies to "right now"). Used by the Progreso chart.
 */
export function projectLift(
  lift: LiftState,
  weeks: number,
  config: EngineConfig = DEFAULT_ENGINE_CONFIG,
): number[] {
  const clean: LiftState = { ...lift, hold: false, holdAtKg: null };
  return Array.from({ length: Math.max(0, weeks) }, (_, i) =>
    workingWeightKg(clean, i + 1, config),
  );
}

/** Sets prescribed for a week, halved on the deload when auto-deload is on. */
export function setsForWeek(
  baseSets: number,
  week: number,
  config: EngineConfig = DEFAULT_ENGINE_CONFIG,
): number {
  if (!config.autoDeload || !isDeloadWeek(week, config)) return baseSets;
  return Math.max(1, Math.round(baseSets / 2));
}

/* ── regression ──────────────────────────────────────────────── */

const LADDERS: Record<RegressionRule, readonly [number, number, number]> = {
  // First two misses only freeze the weight; the RM survives.
  conservative: [0, 0, 0.05],
  // The default from the plan: hold, then −5 %, then −10 %.
  standard: [0, 0.05, 0.1],
  // Cut on the very first miss.
  aggressive: [0.05, 0.1, 0.15],
};

export function regressionLadder(
  rule: RegressionRule,
): readonly [number, number, number] {
  return LADDERS[rule] ?? LADDERS.standard;
}

/** A set counts as a failure when it lands under the prescribed minimum. */
export function isRangeFailure(reps: number, repMin: number): boolean {
  return Number.isFinite(reps) && reps < repMin;
}

/**
 * Apply one range failure on the basic lift of the day.
 *
 * Strike 1 (standard rule): freeze the weight — the athlete repeats it.
 * Strike 2: cut the estimated RM 5 %, the wave recomputes from the new RM.
 * Strike 3: cut 10 % and force a deload (2 sets @ 70 %).
 */
export function registerFailure(
  lift: LiftState,
  missedAtKg: number,
  week: number,
  config: EngineConfig = DEFAULT_ENGINE_CONFIG,
): RegressionOutcome {
  const ladder = regressionLadder(config.regressionRule);
  const failCount = Math.min(lift.failCount + 1, 3);
  const penalty = ladder[failCount - 1];

  if (penalty === 0) {
    const next: LiftState = {
      ...lift,
      failCount,
      hold: true,
      holdAtKg: round2(missedAtKg),
    };
    const nextPenalty = ladder[Math.min(failCount, 2)];
    return {
      lift: next,
      action: "hold",
      penaltyApplied: 0,
      forcedDeload: false,
      title: `Fallo ${failCount} · peso en espera`,
      detail:
        `Se repite ${formatWeight(missedAtKg)} kg en la próxima sesión de ` +
        `${lift.name.toLowerCase()}; si toca descarga, manda la descarga. ` +
        `Otro fallo y la RM baja un ${Math.round(nextPenalty * 100)} %.`,
    };
  }

  const next: LiftState = {
    ...lift,
    failCount,
    penalty,
    hold: false,
    holdAtKg: null,
  };
  const forcedDeload = failCount >= 3;
  const recomputed = workingWeightKg(next, week, config);

  return {
    lift: next,
    action: "penalty",
    penaltyApplied: penalty,
    forcedDeload,
    title: `Fallo ${failCount} · RM −${Math.round(penalty * 100)} %`,
    detail:
      `RM estimada a ${formatWeight(roundToStep(lift.e1rmKg * (1 - penalty), config.roundingKg))} kg. ` +
      `La ola se recalcula: ${formatWeight(recomputed)} kg` +
      (forcedDeload ? " + descarga forzada (2 series @ 70 %)." : "."),
  };
}

/** Undo the last failure — the banner's "deshacer". */
export function revertFailure(lift: LiftState): LiftState {
  return {
    ...lift,
    failCount: Math.max(0, lift.failCount - 1),
    penalty: 0,
    hold: false,
    holdAtKg: null,
  };
}

/**
 * A session where every set of the basic landed inside the range clears the
 * counter and releases the hold. Penalties are *not* refunded here — the RM
 * climbs back through the normal cycle bump, as the plan describes.
 */
export function registerCleanSession(lift: LiftState): LiftState {
  if (!lift.hold && lift.failCount === 0) return lift;
  return { ...lift, failCount: 0, hold: false, holdAtKg: null };
}

/* ── 1RM estimation ──────────────────────────────────────────── */

/** Epley: 1RM ≈ w × (1 + reps/30). The plan's chosen formula. */
export function epley1RM(weightKg: number, reps: number): number {
  if (reps <= 0) return 0;
  if (reps === 1) return round2(weightKg);
  return round2(weightKg * (1 + reps / 30));
}

/** Inverse Epley: the load that should yield `reps`. */
export function epleyLoad(e1rmKg: number, reps: number): number {
  if (reps <= 0) return 0;
  return round2(e1rmKg / (1 + reps / 30));
}

/* ── plates ──────────────────────────────────────────────────── */

export interface PlateLoad {
  /** Plates for ONE side of the bar, heaviest first. */
  perSide: number[];
  /** Weight the plates cannot reach, in kg (should be 0 with sane rounding). */
  remainderKg: number;
  /** True when the target is the empty bar or less. */
  barOnly: boolean;
  barKg: number;
}

/** Greedy plate breakdown, per side. */
export function plateBreakdown(
  targetKg: number,
  config: Pick<EngineConfig, "barKg" | "platesKg"> = DEFAULT_ENGINE_CONFIG,
): PlateLoad {
  const barKg = config.barKg;
  let side = round2((targetKg - barKg) / 2);
  if (side <= 0) {
    return { perSide: [], remainderKg: 0, barOnly: true, barKg };
  }
  const plates = [...config.platesKg].sort((a, b) => b - a);
  const perSide: number[] = [];
  for (const plate of plates) {
    while (side >= plate - 0.001 && perSide.length < 12) {
      perSide.push(plate);
      side = round2(side - plate);
    }
  }
  return { perSide, remainderKg: Math.max(0, side), barOnly: false, barKg };
}

/** "25 · 20 · 5" — the chips under the big number. */
export function formatPlates(load: PlateLoad): string {
  if (load.barOnly) return `barra ${formatWeight(load.barKg)}`;
  return load.perSide.map(formatWeight).join(" · ");
}

/** Round a dumbbell to the nearest pair the athlete actually owns. */
export function roundDumbbell(targetKg: number, stepKg: number): number {
  return roundToStep(targetKg, stepKg > 0 ? stepKg : 2.5);
}

/* ── load resolver ───────────────────────────────────────────── */

/**
 * The nearest weight the athlete can actually load for a target, given
 * what the exercise hangs from. Kettlebells are a discrete set, not a
 * step: 14 kg does not exist, 12 or 16 does.
 */
export function loadableWeight(
  targetKg: number,
  equipment: Equipment | null | undefined,
  config: EngineConfig = DEFAULT_ENGINE_CONFIG,
): number {
  if (!Number.isFinite(targetKg)) return 0;
  switch (equipment) {
    case "barbell":
      return roundToStep(targetKg, config.roundingKg);
    case "dumbbell":
      return roundDumbbell(targetKg, config.dumbbellStepKg);
    case "pulley":
    case "machine":
      return roundToStep(targetKg, config.pulleyStepKg);
    case "kettlebell": {
      const bells = config.kettlebellsKg.filter((k) => k > 0);
      if (!bells.length) return roundToStep(targetKg, config.roundingKg);
      // Nearest bell; ties go to the lighter one — never prescribe up.
      return bells.reduce((best, k) => {
        const d = Math.abs(k - targetKg);
        const bd = Math.abs(best - targetKg);
        return d < bd || (d === bd && k < best) ? k : best;
      });
    }
    case "bodyweight":
    case "band":
    case "dip_bars":
      return round2(targetKg);
    default:
      return roundToStep(targetKg, config.roundingKg);
  }
}

/* ── warm-up ─────────────────────────────────────────────────── */

export interface WarmupSet {
  weightKg: number;
  reps: number;
  pct: number;
}

/**
 * Approach sets for the basic of the day: 2–3 ramps plus the bar.
 * "2-3 series de aproximación en el primer básico" from the plan.
 */
export function warmupSets(
  workKg: number,
  config: EngineConfig = DEFAULT_ENGINE_CONFIG,
): WarmupSet[] {
  if (workKg <= config.barKg) return [];
  const ramps = [
    { pct: 0.4, reps: 8 },
    { pct: 0.6, reps: 5 },
    { pct: 0.8, reps: 3 },
  ];
  const out: WarmupSet[] = [
    { weightKg: config.barKg, reps: 10, pct: round2(config.barKg / workKg) },
  ];
  for (const r of ramps) {
    const w = roundToStep(workKg * r.pct, config.roundingKg);
    if (w > config.barKg && w < workKg) {
      out.push({ weightKg: w, reps: r.reps, pct: r.pct });
    }
  }
  return out;
}

/* ── tonnage ─────────────────────────────────────────────────── */

export function tonnage(
  sets: Array<{ weightKg: number | null; reps: number | null }>,
): number {
  return round2(
    sets.reduce((acc, s) => acc + (s.weightKg ?? 0) * (s.reps ?? 0), 0),
  );
}

/** "12,4 t" — tonnage headline. */
export function formatTonnage(kg: number): string {
  return `${formatWeight(Math.round(kg / 100) / 10)} t`;
}
