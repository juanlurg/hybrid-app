/**
 * Double progression for accessories, straight from FUERZA-juanlu.md:
 * "todas las series en el tope del rango con RIR≥1 → +2.5 kg barra /
 * +2 kg por mancuerna / un salto de polea, y de vuelta al mínimo del
 * rango". Pure — the caller persists the new weight and the event.
 *
 * Only the basic of the day moves the RM engine; this module only
 * ever touches `fixed_weight_kg` of non-primary rows.
 */

import { loadableWeight, round2, roundToStep } from ".";
import type { Effort, EngineConfig, Equipment, LoadMode } from "./types";

export interface AccessorySetLog {
  reps: number | null;
  seconds: number | null;
  rir: number | null;
  /** The load the set actually went on. Absent = the prescribed one. */
  weightKg?: number | null;
}

export interface AccessoryProgressionInput {
  equipment: Equipment | null;
  effort: Effort;
  /**
   * Belt-loaded work (`weighted_bodyweight`) progresses by plate steps
   * regardless of `equipment`, which for those rows is just "bodyweight"
   * — the increment would otherwise resolve to 0 and never move.
   */
  loadMode?: LoadMode;
  /** Bottom of the prescribed range. Absent = a real range under `repMax`. */
  repMin?: number;
  /** Top of the prescribed range (reps or seconds, per `effort`). */
  repMax: number;
  /** Sets prescribed for the session as run (after any deload halving). */
  plannedSets: number;
  currentWeightKg: number | null;
  /** In set order: the last one is the load the athlete ended on. */
  logs: AccessorySetLog[];
  /** Minimum reserve to still call it clean. The doc says 1. */
  minRir?: number;
}

export interface AccessoryProgressionOutcome {
  advance: boolean;
  /**
   * What the next session starts from: the load of the last set logged
   * (the prescription follows the bar), plus the jump when it was earned.
   */
  nextWeightKg: number | null;
  reason: string;
}

/** The jump one clean session earns, by equipment. */
export function equipmentIncrementKg(
  equipment: Equipment | null,
  config: EngineConfig,
): number {
  switch (equipment) {
    case "barbell":
      return config.roundingKg;
    case "dumbbell":
      return config.dumbbellStepKg;
    case "pulley":
    case "machine":
      return config.pulleyStepKg;
    default:
      return 0;
  }
}

export function doubleProgression(
  input: AccessoryProgressionInput,
  config: EngineConfig,
): AccessoryProgressionOutcome {
  const {
    equipment,
    effort,
    repMax,
    plannedSets,
    currentWeightKg,
    logs,
  } = input;
  const minRir = input.minRir ?? 1;

  // The athlete can move the load mid-session; where they ended is the
  // weight the next session starts from, earned jump or not.
  const moved = logs.findLast((l) => l.weightKg != null)?.weightKg ?? null;
  const baseKg = moved ?? currentWeightKg;

  const hold = (reason: string): AccessoryProgressionOutcome => ({
    advance: false,
    nextWeightKg: baseKg,
    reason,
  });

  const weightedBodyweight = input.loadMode === "weighted_bodyweight";
  if (input.loadMode === "rpe") {
    return hold("a sensación: los kilos se recuerdan, no se progresan");
  }
  if (baseKg == null || (baseKg <= 0 && !weightedBodyweight)) {
    // A belt at 0 kg is a valid start — the first bump adds the lastre.
    return hold("sin carga externa que progresar");
  }
  if (effort === "amrap") {
    return hold("AMRAP progresa por reps, no por kilos");
  }
  if (plannedSets <= 0 || logs.length < plannedSets) {
    return hold("sesión incompleta");
  }
  if (logs.some((l) => l.weightKg != null && l.weightKg < baseKg)) {
    return hold("alguna serie fue con menos peso que la última");
  }

  const value = (l: AccessorySetLog) =>
    effort === "seconds" ? l.seconds : l.reps;
  const allAtTop = logs.every((l) => (value(l) ?? 0) >= repMax);
  if (!allAtTop) {
    return hold("series por debajo del tope del rango");
  }
  const rirOk = logs.every((l) => l.rir == null || l.rir >= minRir);
  if (!rirOk) {
    return hold(`RIR por debajo de ${minRir}`);
  }
  // A one-number range has no bottom to climb from: every finished
  // session is "all at the top", so the jump needs a noted reserve.
  if (input.repMin === repMax && logs.every((l) => l.rir == null)) {
    return hold("rango de un solo número: sin RIR anotado no sube");
  }

  if (weightedBodyweight) {
    const next = roundToStep(
      round2(baseKg + config.roundingKg),
      config.roundingKg,
    );
    if (next <= baseKg) {
      return hold("el incremento no produce una carga mayor alcanzable");
    }
    return {
      advance: true,
      nextWeightKg: next,
      reason: `tope del rango en todas las series → +${round2(next - baseKg)} kg de lastre`,
    };
  }

  if (equipment === "kettlebell") {
    const bells = [...config.kettlebellsKg].filter((k) => k > 0).sort((a, b) => a - b);
    const nextBell = bells.find((k) => k > baseKg);
    if (nextBell == null) {
      return hold("no hay una kettlebell más pesada disponible");
    }
    return {
      advance: true,
      nextWeightKg: nextBell,
      reason: `tope del rango en todas las series → siguiente kettlebell (${nextBell} kg)`,
    };
  }

  const inc = equipmentIncrementKg(equipment, config);
  if (inc <= 0) {
    return hold("el material no admite incrementos de carga");
  }

  const next = loadableWeight(round2(baseKg + inc), equipment, config);
  if (next <= baseKg) {
    return hold("el incremento no produce una carga mayor alcanzable");
  }
  return {
    advance: true,
    nextWeightKg: next,
    reason: `tope del rango en todas las series → +${round2(next - baseKg)} kg`,
  };
}
