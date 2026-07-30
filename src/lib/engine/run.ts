/**
 * Running side of the engine: heart-rate zones from LTHR, and turning a
 * one-line prescription ("45' Z2 + 6 cuestas 20\"") into the block list the
 * Carrera screen renders.
 */

export type ZoneKey = "Z1" | "Z2" | "Z3" | "Z4" | "Z5";

export interface Zone {
  key: ZoneKey;
  /** Fraction of LTHR, lower bound inclusive. */
  fromPct: number;
  /** Upper bound inclusive. `null` on Z5 — there is no ceiling. */
  toPct: number | null;
  loBpm: number;
  hiBpm: number | null;
  label: string;
  use: string;
}

/** The plan's LTHR table (Carrera §1). */
const ZONE_SPEC: Array<Omit<Zone, "loBpm" | "hiBpm">> = [
  {
    key: "Z1",
    fromPct: 0,
    toPct: 0.8,
    label: "Muy fácil, respiración nasal posible",
    use: "Recuperación",
  },
  {
    key: "Z2",
    fromPct: 0.81,
    toPct: 0.89,
    label: "Conversación en frases completas",
    use: "El 80 % de tu volumen",
  },
  {
    key: "Z3",
    fromPct: 0.9,
    toPct: 0.93,
    label: "Frases cortas",
    use: 'Evitar el "gris" salvo finales progresivos',
  },
  {
    key: "Z4",
    fromPct: 0.94,
    toPct: 0.99,
    label: "Palabras sueltas",
    use: "Tempo, cruise intervals",
  },
  {
    key: "Z5",
    fromPct: 1,
    toPct: null,
    label: "Insostenible más de 5-6′",
    use: "Cuestas, VO2",
  },
];

export function hrZones(lthr: number): Zone[] {
  return ZONE_SPEC.map((z) => ({
    ...z,
    loBpm: Math.round(lthr * z.fromPct),
    hiBpm: z.toPct == null ? null : Math.round(lthr * z.toPct),
  }));
}

export function zoneRange(lthr: number, key: ZoneKey): string {
  const z = hrZones(lthr).find((x) => x.key === key);
  if (!z) return "—";
  return z.hiBpm == null ? `≥ ${z.loBpm} ppm` : `${z.loBpm}–${z.hiBpm} ppm`;
}

/* ── prescription → blocks ───────────────────────────────────── */

export interface RunBlock {
  title: string;
  zone: string;
  duration: string;
  hr: string;
  note: string;
  /** Which accent the coloured rule uses. */
  tone: "easy" | "threshold" | "hard";
}

/**
 * Minutes a prescription is worth, for weekly volume.
 * Sums every `N'` it can find and expands `N×M'` interval notation.
 */
export function prescriptionMinutes(text: string): number {
  if (!text) return 0;
  let total = 0;
  for (const m of text.matchAll(/(\d+)\s*['′]/g)) total += parseInt(m[1], 10);
  const interval = text.match(/(\d+)\s*[×x]\s*(\d+)\s*['′]/);
  if (interval) {
    // "3×8'" already contributed 3 and 8 above; charge the remaining reps.
    total += (parseInt(interval[1], 10) - 1) * parseInt(interval[2], 10);
  }
  // Distance-based long runs ("18 km, 6 km a RM al final") — 5:30/km ballpark.
  if (total === 0) {
    const km = text.match(/(\d+)\s*km/i);
    if (km) total = Math.round(parseInt(km[1], 10) * 5.5);
  }
  return Math.max(0, total);
}

/**
 * Expand a prescription into the coloured blocks the Carrera screen shows.
 * Recognises the shapes actually used by the plan: LTHR test, cruise
 * intervals, hill reps, strides, and plain Z2 running.
 */
export function runBlocks(text: string, lthr: number): RunBlock[] {
  const z = hrZones(lthr);
  const z2 = z.find((x) => x.key === "Z2")!;
  const z4 = z.find((x) => x.key === "Z4")!;
  const hrZ2 = `${z2.loBpm}–${z2.hiBpm} ppm`;

  if (/test\s*lthr/i.test(text)) {
    return lthrTestBlocks(z2, "");
  }

  const interval = text.match(/(\d+)\s*[×x]\s*(\d+)\s*['′]\s*Z4/i);
  if (interval) {
    const reps = parseInt(interval[1], 10);
    const mins = parseInt(interval[2], 10);
    return [
      {
        title: "Calentamiento",
        zone: "Z2",
        duration: "10′",
        hr: hrZ2,
        note: "",
        tone: "easy",
      },
      {
        title: `${reps} × ${mins}′ cruise intervals`,
        zone: "Z4",
        duration: `${reps * mins}′ + rec 3′`,
        hr: `${z4.loBpm}–${z4.hiBpm}`,
        note: "Cómodamente duro. Palabras sueltas, no frases.",
        tone: "threshold",
      },
      {
        title: "Vuelta a la calma",
        zone: "Z2",
        duration: "10′",
        hr: hrZ2,
        note: "",
        tone: "easy",
      },
    ];
  }

  const tempo = text.match(/(\d+)\s*['′]\s*(tempo|Z4)/i);
  if (tempo) {
    const mins = parseInt(tempo[1], 10);
    return [
      {
        title: "Calentamiento",
        zone: "Z2",
        duration: "15′",
        hr: hrZ2,
        note: "",
        tone: "easy",
      },
      {
        title: `Tempo continuo ${mins}′`,
        zone: "Z4",
        duration: `${mins}′`,
        hr: `${z4.loBpm}–${z4.hiBpm}`,
        note: "El motor del umbral. Ritmo constante, sin picos.",
        tone: "threshold",
      },
      {
        title: "Vuelta a la calma",
        zone: "Z1",
        duration: "10′",
        hr: `< ${z2.loBpm}`,
        note: "",
        tone: "easy",
      },
    ];
  }

  const total = prescriptionMinutes(text) || 45;
  const blocks: RunBlock[] = [
    {
      title: "Calentamiento",
      zone: "Z1→Z2",
      duration: "10′",
      hr: `< ${z2.hiBpm}`,
      note: "",
      tone: "easy",
    },
    {
      title: "Rodaje continuo",
      zone: "Z2",
      duration: `${Math.max(total - 10, 20)}′`,
      hr: hrZ2,
      note: "Conversación en frases completas. Si no puedes, vas en Z3.",
      tone: "easy",
    },
  ];

  const hills = text.match(/(\d+)\s*cuestas/i);
  if (hills) {
    blocks.push({
      title: `${hills[1]} × cuesta 20″`,
      zone: "Z5",
      duration: "~10′",
      hr: "sin mirar el pulso",
      note: "Empinada, al ~95 %. Recuperación bajando andando.",
      tone: "hard",
    });
  }

  const strides = text.match(/(\d+)\s*strides/i);
  if (strides) {
    blocks.push({
      title: `${strides[1]} × stride 20″`,
      zone: "Z5",
      duration: "~6′",
      hr: "sin mirar el pulso",
      note: "Al ~90 %, recuperación completa. Economía a coste cero.",
      tone: "hard",
    });
  }

  blocks.push({
    title: "Vuelta a la calma",
    zone: "Z1",
    duration: "5′",
    hr: `< ${z2.loBpm}`,
    note: "",
    tone: "easy",
  });

  return blocks;
}

/* ── structured prescription → blocks ────────────────────────── */

export type StructureZone = "Z1" | "Z2" | "Z3" | "Z4" | "Z5" | "RM";

/**
 * One typed block of `program_run_sessions.structure`. The free-text
 * prescription stays as the label; this is what the screens compute
 * from. Regex parsing of Spanish is the fallback, not the source.
 */
export interface RunBlockSpec {
  kind:
    | "steady"
    | "interval"
    | "hills"
    | "strides"
    | "test"
    | "race"
    | "walk"
    | "rest";
  repeat?: number;
  workMin?: number;
  workKm?: number;
  workSec?: number;
  zone?: StructureZone;
  recMin?: number;
  note?: string;
}

export type RunStructure = RunBlockSpec[];

const SPEC_KINDS = new Set([
  "steady", "interval", "hills", "strides", "test", "race", "walk", "rest",
]);

/** Lenient validation of the jsonb column. Anything off → null → legacy parser. */
export function parseStructure(json: unknown): RunStructure | null {
  if (!Array.isArray(json) || json.length === 0) return null;
  const ok = json.every(
    (b) =>
      b != null &&
      typeof b === "object" &&
      SPEC_KINDS.has((b as { kind?: unknown }).kind as string),
  );
  return ok ? (json as RunStructure) : null;
}

const ZONE_TONES: Record<StructureZone, RunBlock["tone"]> = {
  Z1: "easy",
  Z2: "easy",
  Z3: "threshold",
  Z4: "threshold",
  Z5: "hard",
  RM: "threshold",
};

function fmtMin(min: number): string {
  if (Number.isInteger(min)) return `${min}′`;
  const whole = Math.floor(min);
  const secs = Math.round((min - whole) * 60);
  return whole > 0 ? `${whole}′${secs}″` : `${secs}″`;
}

/** The canonical 3-block LTHR test, shared with the legacy parser. */
function lthrTestBlocks(z2: Zone, note: string): RunBlock[] {
  return [
    {
      title: "Calentamiento",
      zone: "Z1–Z2",
      duration: "15′",
      hr: `< ${z2.hiBpm}`,
      note: "Progresivo, terminar suelto.",
      tone: "easy",
    },
    {
      title: "Test de umbral",
      zone: "MÁX",
      duration: "30′",
      hr: "llano, constante",
      note: note || "LTHR = FC media de los últimos 20 minutos.",
      tone: "hard",
    },
    {
      title: "Vuelta a la calma",
      zone: "Z1",
      duration: "10′",
      hr: `< ${z2.loBpm}`,
      note: "",
      tone: "easy",
    },
  ];
}

/**
 * Expand a typed structure into the blocks the Carrera screen shows.
 * Quality work gets a standard warm-up and cool-down wrapped around it;
 * plain Z2 running, walks and races render as written.
 */
export function structuredBlocks(
  structure: RunStructure,
  lthr: number,
): RunBlock[] {
  const zones = hrZones(lthr);
  const zoneBy = (key: ZoneKey) => zones.find((z) => z.key === key)!;
  const z2 = zoneBy("Z2");

  const hrFor = (zone: StructureZone | undefined): string => {
    if (zone === "RM") return "ritmo de media, no pulso";
    if (!zone) return "";
    const z = zoneBy(zone);
    return z.hiBpm == null ? `≥ ${z.loBpm}` : `${z.loBpm}–${z.hiBpm}`;
  };

  const steadyTitle = (b: RunBlockSpec): string => {
    if (b.zone === "RM") return "A ritmo de media";
    if (b.zone === "Z4") return `Tempo continuo ${fmtMin(b.workMin ?? 0)}`;
    if (b.zone === "Z3") return "Final progresivo";
    if (b.zone === "Z1") return "Rodaje suave";
    return "Rodaje continuo";
  };

  const core: RunBlock[] = [];
  for (const b of structure) {
    switch (b.kind) {
      case "rest":
        break;
      case "test":
        return lthrTestBlocks(z2, b.note ?? "");
      case "walk":
        core.push({
          title: "Caminata",
          zone: "—",
          duration: b.workKm != null ? `${b.workKm} km` : fmtMin(b.workMin ?? 0),
          hr: "sin mirar el pulso",
          note: b.note ?? "",
          tone: "easy",
        });
        break;
      case "race":
        core.push({
          title: b.workKm === 10 ? "10K a tope" : "Carrera",
          zone: b.zone ?? "RM",
          duration: b.workKm != null ? `${formatKm(b.workKm)} km` : "",
          hr: hrFor(b.zone ?? "RM"),
          note: b.note ?? "",
          tone: "hard",
        });
        break;
      case "hills":
        core.push({
          title: `${b.repeat ?? 1} × cuesta ${b.workSec ?? 20}″`,
          zone: "Z5",
          duration: "~10′",
          hr: "sin mirar el pulso",
          note: b.note || "Empinada, al ~95 %. Recuperación bajando andando.",
          tone: "hard",
        });
        break;
      case "strides":
        core.push({
          title: `${b.repeat ?? 1} × stride ${b.workSec ?? 20}″`,
          zone: "Z5",
          duration: "~6′",
          hr: "sin mirar el pulso",
          note: b.note || "Al ~90 %, recuperación completa. Economía a coste cero.",
          tone: "hard",
        });
        break;
      case "interval": {
        const reps = b.repeat ?? 1;
        const per =
          b.workKm != null ? `${formatKm(b.workKm)} km` : fmtMin(b.workMin ?? 0);
        const total =
          b.workKm != null
            ? `${formatKm(reps * b.workKm)} km`
            : fmtMin(reps * (b.workMin ?? 0));
        core.push({
          title: `${reps} × ${per} ${b.zone === "RM" ? "a RM" : (b.zone ?? "")}`.trim(),
          zone: b.zone ?? "Z4",
          duration: b.recMin != null ? `${total} + rec ${fmtMin(b.recMin)}` : total,
          hr: hrFor(b.zone),
          note:
            b.note ||
            (b.zone === "Z4" ? "Cómodamente duro. Palabras sueltas, no frases." : ""),
          tone: b.zone ? ZONE_TONES[b.zone] : "threshold",
        });
        break;
      }
      case "steady":
        core.push({
          title: steadyTitle(b),
          zone: b.zone ?? "Z2",
          duration:
            b.workKm != null ? `${formatKm(b.workKm)} km` : fmtMin(b.workMin ?? 0),
          hr: hrFor(b.zone ?? "Z2"),
          note:
            b.note ||
            (b.zone === "Z2" || b.zone == null
              ? "Conversación en frases completas. Si no puedes, vas en Z3."
              : ""),
          tone: b.zone ? ZONE_TONES[b.zone] : "easy",
        });
        break;
    }
  }

  if (core.length === 0) return [];

  const isQuality = (b: RunBlockSpec) =>
    b.kind === "interval" ||
    (b.kind === "steady" && (b.zone === "Z4" || b.zone === "Z5" || b.zone === "RM"));
  const hasQuality = structure.some(isQuality);
  const startsWithQuality = isQuality(structure[0]);
  const isRaceOrWalk = structure.every(
    (b) => b.kind === "race" || b.kind === "walk" || b.kind === "rest",
  );

  if (isRaceOrWalk) return core;

  const out: RunBlock[] = [];
  if (startsWithQuality) {
    out.push({
      title: "Calentamiento",
      zone: "Z2",
      duration: "10′",
      hr: `${z2.loBpm}–${z2.hiBpm}`,
      note: "",
      tone: "easy",
    });
  }
  out.push(...core);
  if (hasQuality) {
    out.push({
      title: "Vuelta a la calma",
      zone: "Z1",
      duration: "10′",
      hr: `< ${z2.loBpm}`,
      note: "",
      tone: "easy",
    });
  } else if (structure.some((b) => b.kind === "hills" || b.kind === "strides")) {
    out.push({
      title: "Vuelta a la calma",
      zone: "Z1",
      duration: "5′",
      hr: `< ${z2.loBpm}`,
      note: "",
      tone: "easy",
    });
  }
  return out;
}

function formatKm(km: number): string {
  return Number.isInteger(km) ? String(km) : km.toFixed(1).replace(".", ",");
}

/** Minutes a structured session is worth, for weekly volume. */
export function structureMinutes(structure: RunStructure): number {
  let total = 0;
  for (const b of structure) {
    const reps = b.repeat ?? 1;
    if (b.workMin != null) {
      total += reps * b.workMin + (b.recMin ?? 0) * Math.max(0, reps - 1);
    } else if (b.workKm != null) {
      // 5:30/km ballpark, same as the legacy parser.
      total += Math.round(reps * b.workKm * 5.5) + (b.recMin ?? 0) * Math.max(0, reps - 1);
    } else if (b.kind === "hills" || b.kind === "strides") {
      total += Math.round(reps * 1.5);
    }
  }
  return Math.max(0, Math.round(total));
}

/**
 * Pa:HR decoupling — the plan's real "is my base improving" metric.
 * Compares output-per-heartbeat in the first and second halves of a run.
 * Under 5 % drift at constant pace = aerobic base is holding.
 */
export function decoupling(
  firstHalf: { paceSecPerKm: number; avgHr: number },
  secondHalf: { paceSecPerKm: number; avgHr: number },
): number {
  const ratio = (h: { paceSecPerKm: number; avgHr: number }) =>
    h.paceSecPerKm > 0 && h.avgHr > 0 ? 1000 / h.paceSecPerKm / h.avgHr : 0;
  const a = ratio(firstHalf);
  const b = ratio(secondHalf);
  if (a === 0) return 0;
  return Math.round(((a - b) / a) * 1000) / 10;
}

/** Half-marathon target pace from a 10K time: 10K pace + 15–20 s/km. */
export function halfTargetPace(tenKSeconds: number): {
  loSecPerKm: number;
  hiSecPerKm: number;
} {
  const tenKPace = tenKSeconds / 10;
  return {
    loSecPerKm: Math.round(tenKPace + 15),
    hiSecPerKm: Math.round(tenKPace + 20),
  };
}

export function formatPace(secPerKm: number): string {
  const m = Math.floor(secPerKm / 60);
  const s = Math.round(secPerKm % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}
