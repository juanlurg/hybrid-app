/**
 * Double progression for accessories, straight from FUERZA-juanlu.md:
 * "todas las series en el tope del rango con RIR≥1 → +2.5 kg barra /
 * +2 kg por mancuerna / un salto de polea, y de vuelta al mínimo del
 * rango". Pure — the caller persists the new weight and the event.
 *
 * Only the basic of the day moves the RM engine; this module only
 * ever touches `fixed_weight_kg` of non-primary rows.
 */

import { loadableWeight, round2 } from ".";
import type { Effort, EngineConfig, Equipment } from "./types";

export interface AccessorySetLog {
  reps: number | null;
  seconds: number | null;
  rir: number | null;
}

export interface AccessoryProgressionInput {
  equipment: Equipment | null;
  effort: Effort;
  /** Top of the prescribed range (reps or seconds, per `effort`). */
  repMax: number;
  /** Sets prescribed for the session as run (after any deload halving). */
  plannedSets: number;
  currentWeightKg: number | null;
  logs: AccessorySetLog[];
  /** Minimum reserve to still call it clean. The doc says 1. */
  minRir?: number;
}

export interface AccessoryProgressionOutcome {
  advance: boolean;
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

  const hold = (reason: string): AccessoryProgressionOutcome => ({
    advance: false,
    nextWeightKg: currentWeightKg,
    reason,
  });

  if (currentWeightKg == null || currentWeightKg <= 0) {
    return hold("sin carga externa que progresar");
  }
  if (effort === "amrap") {
    return hold("AMRAP progresa por reps, no por kilos");
  }
  if (plannedSets <= 0 || logs.length < plannedSets) {
    return hold("sesión incompleta");
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

  if (equipment === "kettlebell") {
    const bells = [...config.kettlebellsKg].filter((k) => k > 0).sort((a, b) => a - b);
    const nextBell = bells.find((k) => k > currentWeightKg);
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

  const next = loadableWeight(round2(currentWeightKg + inc), equipment, config);
  if (next <= currentWeightKg) {
    return hold("el incremento no produce una carga mayor alcanzable");
  }
  return {
    advance: true,
    nextWeightKg: next,
    reason: `tope del rango en todas las series → +${round2(next - currentWeightKg)} kg`,
  };
}
