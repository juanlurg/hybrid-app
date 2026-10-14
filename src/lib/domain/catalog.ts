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

/** Technique GIF per catalogue slug, served from `public/ejercicios/`.
 *  From hasaneyldrm/exercises-dataset; the media is © Gym visual, kept at
 *  its 180×180 and shown with `GIF_CREDIT`. Where the dataset has no exact
 *  match the closest movement stands in (noted alongside). */
const EXERCISE_GIFS: Record<string, string> = {
  sentadilla: "0043-qXTaZnJ",
  "sentadilla-goblet": "0534-ZA8b5hc",
  "press-banca": "0025-EIeI8Vf",
  "press-banca-ligero": "0025-EIeI8Vf",
  "press-militar": "1456-wdRZISl",
  "press-militar-landmine": "0361-84RyJf8", // one-arm dumbbell press
  "press-inclinado-mancuernas": "0314-ns0SIbU",
  "remo-barra": "3017-r0z6xzQ",
  "remo-polea": "0861-fUBheHs",
  dominadas: "0652-lBDjFxJ",
  "dominadas-lastradas": "0841-HMzLjXx",
  "dominadas-supinas": "1326-T2mxWqc",
  "jalon-al-pecho": "0198-RVwzP10",
  rdl: "0085-wQ2c4XD",
  "single-leg-rdl": "1757-gKozT8X", // dumbbell, not kettlebell
  "hip-thrust": "1409-qKBpF7I", // barbell glute bridge
  "hip-thrust-ligero": "1409-qKBpF7I",
  "split-bulgaro": "0410-qx4fgX7",
  "zancada-bulgara": "0410-qx4fgX7",
  fondos: "0251-9WTm7dq",
  "face-pull": "0203-wqNPGCg", // rope rear-delt row
  "rotacion-externa-banda": "0235-FWdVhcW", // cable, not band
  "curl-triceps": "0868-G08RZcQ", // the curl half
  "curl-martillo": "0313-slDvUAU",
  "extension-triceps": "0194-2IxROQ1",
  "elevaciones-laterales": "0334-DsgkuIt",
  "copenhagen-plank": "1775-VO2qeJg", // side plank hip adduction
  "plancha-lateral": "0705-RKjH6Lt",
  "pallof-press": "0979-9pa4H5m",
  "nordico-excentrico": "0496-ms7tjSG", // inverse leg curl
  "calf-raise": "1372-8ozhUIZ",
  "soleo-excentrico": "0409-1kB3Wmk", // single-leg calf raise
  "soleo-sentado": "1379-r29jP7S",
  "tibialis-raise": "1396-Y4QlY8z", // smith toe raise
  "farmer-carry": "2133-qPEzJjA",
  "abduccion-cadera": "0597-CHpahtl", // machine
  "step-down-excentrico": "0431-aXtJhlg", // step-up, run backwards
};

export const GIF_CREDIT = "© Gym visual";
export const GIF_CREDIT_URL = "https://gymvisual.com/";

export function gifFor(slug: string | undefined): string | null {
  const file = slug ? EXERCISE_GIFS[slug] : undefined;
  return file ? `/ejercicios/${file}.gif` : null;
}

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
