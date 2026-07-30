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
        note: "LTHR = FC media de los últimos 20 minutos.",
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
