/**
 * Catalogue-derived defaults, shared by the editor's picker and the AI
 * layer. Whenever a row enters `program_exercises` from the catalogue,
 * these decide its load mode companions — never hardcoded "fixed"/90s.
 */

import type { Equipment } from "@/lib/engine";

/** The five lift keys the engine tracks. Anything else is not a basic. */
export const LIFT_KEYS = [
  "sentadilla",
  "banca",
  "hipthrust",
  "militar",
  "rdl",
] as const;

export type LiftKey = (typeof LIFT_KEYS)[number];

/** Isometric catalogue entries whose rep range means seconds. */
export const TIMED_SLUGS = new Set(["copenhagen-plank", "plancha-lateral"]);

/** A starting load the athlete can actually rack, per equipment. A `fixed`
 *  row without a weight renders as "—" — the regression the accessory
 *  start-loads migration patched once already. Never insert one again. */
export function seedWeightKg(
  equipment: Equipment | string | null,
  config: { barKg: number; kettlebellsKg: readonly number[] },
): number {
  switch (equipment) {
    case "barbell":
      return config.barKg;
    case "dumbbell":
      return 10;
    case "kettlebell":
      return config.kettlebellsKg.length
        ? Math.min(...config.kettlebellsKg)
        : 12;
    case "pulley":
    case "machine":
      return 20;
    default:
      return 10;
  }
}
