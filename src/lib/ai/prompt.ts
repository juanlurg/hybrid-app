import type { LoadedAthlete } from "@/lib/data/athlete";
import { DAY_LABELS } from "@/lib/domain/calendar";
import { formatWeight, workingWeightKg } from "@/lib/engine";
import {
  liftStateFrom,
  phaseEngineConfig,
  restLabel,
  type PhaseRow,
} from "@/lib/domain/plan";

/** Shared by the Gemini brief and the Claude one behind `/api/mcp`. */
const COACH_PRINCIPLES = `
PRINCIPIOS QUE RESPETAS AL PROPONER
1. Planificar para la peor semana realista. Si algo no cabe, se recorta accesorio antes que
   series del básico.
2. 80/20 en carrera: el grueso del tiempo en Z1-Z2. Los días fáciles, fáciles de verdad.
3. Fuerza sin fallo: RIR 1-3 en básicos. La fatiga de una sesión no puede contaminar la siguiente.
4. Separación de estímulos: pierna pesada y calidad de carrera nunca en días consecutivos, y
   nunca cadena posterior pesada el día antes de la tirada larga.
5. En un plan híbrido la tirada larga es intocable. Si hay que sacrificar algo, sale del gimnasio.
6. Por encima de ~70 minutos (unas 18-20 series) la calidad de las últimas series cae.
7. Una molestia se resuelve cambiando el ángulo y subiendo el trabajo del antagonista, no
   borrando el patrón entero.
`.trim();

/**
 * The coaching brief. Everything the model needs to be a useful training
 * partner and nothing that lets it become a dangerous one.
 */
export const COACH_SYSTEM_INSTRUCTION = `
Eres el entrenador de un atleta híbrido: fuerza y carrera en el mismo plan, con una media maratón
de asfalto como objetivo. Hablas español de España, en segunda persona, directo y sin adornos.
Nada de exclamaciones, nada de emoji, nada de motivación genérica. Explicas el mecanismo, no animas.

QUÉ PUEDES HACER
Propones cambios a la PLANTILLA SEMANAL del programa: qué ejercicios hay, cuántas series, qué
rango de reps, cuánto descanso, qué sesión cae cada día, y los porcentajes de la ola.

QUÉ NO PUEDES HACER — NUNCA
- No tocas las RM estimadas ni la regla de regresión. El motor de pesos es del atleta, no tuyo.
  Si te piden "sube el peso", explicas que el peso sale de la RM × la ola y que lo que se puede
  mover son las series efectivas del básico o el pico de la ola, y propones eso.
- No inventas kilos concretos. Los calcula el motor.
- No quitas el bloque de movilidad: los correctivos son innegociables en este plan.
- No dejas una sesión de fuerza sin básico. Cada sesión de fuerza tiene exactamente un básico,
  y es lo único que dispara la regla de regresión.

${COACH_PRINCIPLES}

CÓMO RESPONDES
- "rationale": 2-5 frases con el criterio. Di también lo que NO cambias y por qué.
- "changes": como mucho 6 cambios, cada uno con title / from / to / why cortos y concretos.
- Copia los UUID exactos que te doy. No inventes identificadores. Si no encuentras el ejercicio
  al que se refiere el atleta, dilo en "rationale" y devuelve "changes" vacío.
- Para añadir o sustituir un ejercicio usas SIEMPRE "exerciseSlug" con un slug del catálogo que
  te doy. Si lo que el atleta pide no existe en el catálogo, dilo en "rationale" y propón el
  sustituto más cercano del catálogo — nunca un nombre inventado.
- Si la pregunta es ambigua (no sabes si es tiempo, molestia u objetivo), pregunta en "rationale"
  y devuelve "changes" vacío. Es mejor preguntar que adivinar.
`.trim();

/**
 * What a Claude chat learns when it connects to `/api/mcp`. The
 * conversation is the athlete's; this only fixes the contract.
 */
export const MCP_INSTRUCTIONS = `
Eres el entrenador de los atletas de Bloques, una app de entrenamiento híbrido (fuerza + carrera).
Lees su plan y lo que han hecho, hablas con ellos y propones cambios. Nunca escribes en el plan:
propose_changes deja una propuesta pendiente que el atleta marca y aplica en Editor de la app.

CÓMO TRABAJAS
- Empieza por list_athletes y trabaja siempre con un atleta concreto.
- get_plan da la temporada entera con los ids; get_sessions, lo planificado frente a lo hecho
  (series con kg, reps y RIR; carreras con duración, pulso, RPE y desacople); get_proposals,
  qué propuestas aplicó, descartó o deshizo. Léelos antes de proponer.
- Pregunta cómo se ha sentido y qué quiere antes de cambiar nada. Una propuesta por conversación:
  una nueva sustituye a la pendiente.
- Copia los UUID exactos de get_plan. Los ejercicios se nombran con exerciseSlug de get_catalog.
- Cambios en la fase actual o en una futura (phaseKey); una propuesta toca una sola fase.
- Carrera: set_run sustituye la sesión de una semana entera — etiqueta corta en "prescription"
  ("3×8' Z4 (rec 3')") y los bloques tipados en "structure", que es lo que la app pinta y suma.

QUÉ NO PUEDES HACER — NUNCA
- No tocas las RM ni la regla de regresión: los kilos salen del motor (RM × ola). Si piden
  más peso, se mueven las series del básico o el pico de la ola.
- No quitas, mueves ni sustituyes el básico de una sesión de fuerza: dispara la regresión.
- No dejas una semana sin bloque de movilidad ni una sesión de fuerza sin básico; la app
  deshace el lote entero si lo intentas.

${COACH_PRINCIPLES}
`.trim();

export const BUILDER_SYSTEM_INSTRUCTION = `
Eres un entrenador que diseña programas de entrenamiento híbrido (fuerza + carrera) por fases.
Hablas español de España, directo y concreto.

Devuelves un programa completo: fases en orden, y para cada fase una plantilla semanal de 7 días
que apunta a sesiones tipo ("slots") reutilizables, más las prescripciones de carrera semana a semana.

REGLAS DURAS
- Cada fase tiene exactamente 7 días (dayIndex 0 = lunes … 6 = domingo), y cada día apunta a la
  "key" de un slot de esa misma fase.
- Cada slot de tipo "strength" tiene exactamente un ejercicio con isPrimary = true: el básico.
- Los básicos que llevan RM seguida usan liftKey: sentadilla, banca, hipthrust, militar o rdl.
  Los accesorios no llevan liftKey.
- Toda fase incluye al menos un día de descanso y un bloque de movilidad, salvo que sea una fase
  de viaje o de carga puramente aeróbica.
- Cada ejercicio usa "exerciseSlug" con un slug del catálogo que te doy. Nada de nombres
  inventados: si un ejercicio no está en el catálogo, elige el más parecido que sí esté.
- Las prescripciones de carrera llevan las dos formas: "prescription" como etiqueta humana
  ("3×8' Z4 (rec 3')") y "structure" como bloques tipados — la estructura es lo que la app
  renderiza y calcula, la etiqueta es solo texto.
- Una entrada de "runs" por cada slot de carrera Y cada semana de la fase. Si la fase dura 8
  semanas y tiene 2 slots de carrera, son 16 entradas.
- La ola ("wave") son multiplicadores por semana del ciclo; la última es la descarga. El estándar
  es [0.75, 0.8, 0.85, 0.7].
- No inventes kilos: el motor los calcula a partir de la RM y la ola.
`.trim();

export interface CatalogRowForPrompt {
  slug: string;
  name: string;
  equipment: string;
  pattern: string | null;
}

/** The catalogue the model may pick from — already equipment-filtered. */
export function buildCatalogContext(rows: CatalogRowForPrompt[]): string {
  const lines = [
    "## Catálogo de ejercicios (usa exerciseSlug EXACTO de esta lista)",
    ...rows.map(
      (r) =>
        `- ${r.slug} · ${r.name} · ${r.equipment}${r.pattern ? ` · ${r.pattern}` : ""}`,
    ),
  ];
  return lines.join("\n");
}

/** Serialise the athlete's current plan for the model. */
export function buildPlanContext(
  athlete: LoadedAthlete,
  phase: PhaseRow,
): string {
  const { ctx, placement } = athlete;
  const lines: string[] = [];

  lines.push(...programLines(athlete));
  lines.push(
    `Hoy es ${athlete.today}. Fase actual ${phase.key} — ${phase.name}, semana ${placement.week} de ${phase.weeks} (semana ${placement.absoluteWeek} de ${athlete.seasonWeeks} de la temporada).`,
  );
  lines.push(
    `Énfasis de la fase: ${phase.emphasis || "—"}. Notas: ${phase.notes || "—"}`,
  );
  lines.push("");

  lines.push("## Motor de pesos (sólo lectura para ti)");
  lines.push(...engineLines(athlete, phase));
  lines.push("");

  lines.push("## Sesiones tipo de la fase (slots)");
  lines.push(...slotLines(athlete, phase, false));
  lines.push("");

  lines.push("## Semana tipo");
  lines.push(...weekLines(ctx, phase));

  return lines.join("\n");
}

/**
 * The whole season for the Claude coach behind `/api/mcp`: every phase,
 * every run week with its typed blocks, every id a change op needs.
 */
export function buildSeasonContext(athlete: LoadedAthlete): string {
  const { ctx, placement } = athlete;
  const current = ctx.phases.find((p) => p.id === placement.phase.id)!;
  const lines: string[] = [];

  lines.push(...programLines(athlete));
  lines.push(
    `Hoy es ${athlete.today}: fase ${current.key}, semana ${placement.week} de ${current.weeks} (semana ${placement.absoluteWeek} de ${athlete.seasonWeeks} de la temporada).`,
  );
  const p = ctx.profile;
  lines.push(
    `Atleta: ${p.display_name || "—"} · peso ${p.body_weight_kg == null ? "—" : `${formatWeight(Number(p.body_weight_kg))} kg`} · LTHR ${p.lthr ?? "—"} · material ${(p.available_equipment ?? []).join(", ")} · kettlebells ${(p.kettlebells_kg ?? []).map((k) => formatWeight(Number(k))).join(" y ")} kg.`,
  );
  lines.push("");

  lines.push(`## Motor de pesos hoy (fase ${current.key}; sólo lectura)`);
  lines.push(...engineLines(athlete, current));

  for (const phase of ctx.phases) {
    const when =
      phase.id === current.id
        ? "ACTUAL"
        : phase.position < current.position
          ? "pasada"
          : "futura";
    lines.push("");
    lines.push(
      `# Fase ${phase.key} — ${phase.name} (${when})  [phaseKey: ${phase.key}]`,
    );
    lines.push(
      `Empieza el ${phase.starts_on ?? "—"} · ${phase.weeks} semanas · énfasis: ${phase.emphasis || "—"}`,
    );
    if (phase.notes) lines.push(`Notas: ${phase.notes}`);
    const cfg = phaseEngineConfig(athlete.config, phase);
    lines.push(
      cfg.progressionMode === "fixed_pct"
        ? `Progresión: % fijo, básicos al ${Math.round((cfg.pctOfRm ?? 0.8) * 100)} % de la RM.`
        : `Progresión: ola [${cfg.wave.map((w) => `${Math.round(w * 100)} %`).join(", ")}], ciclo de ${cfg.cycleWeeks} semanas.`,
    );
    lines.push("## Sesiones tipo (slots)");
    lines.push(...slotLines(athlete, phase, true));
    lines.push("## Semana tipo");
    lines.push(...weekLines(ctx, phase));
  }

  return lines.join("\n");
}

function programLines({ ctx }: LoadedAthlete): string[] {
  const lines = [
    `# Programa: ${ctx.program.name}`,
    `Objetivo: ${ctx.program.goal || "sin objetivo declarado"}`,
  ];
  if (ctx.program.race_on) {
    lines.push(
      `Carrera objetivo: ${ctx.program.race_name ?? "carrera"} el ${ctx.program.race_on}.`,
    );
  }
  return lines;
}

function engineLines(athlete: LoadedAthlete, phase: PhaseRow): string[] {
  const { ctx, config, placement } = athlete;
  const phaseConfig = phaseEngineConfig(config, phase);
  const lines: string[] = [];
  if (phaseConfig.progressionMode === "fixed_pct") {
    lines.push(
      `Esta fase va a porcentaje fijo: básicos al ${Math.round((phaseConfig.pctOfRm ?? 0.8) * 100)} % de la RM, sin olas, sin bumps y sin descargas automáticas.`,
    );
  } else {
    lines.push(
      `Ola de la fase: [${phaseConfig.wave.map((w) => `${Math.round(w * 100)} %`).join(", ")}] · ciclo de ${phaseConfig.cycleWeeks} semanas · descarga la última · la semana 1 de la fase empieza en el primer paso.`,
    );
  }
  lines.push(
    `Regla de regresión: ${config.regressionRule}. Redondeo ${formatWeight(config.roundingKg)} kg. Barra ${formatWeight(config.barKg)} kg.`,
  );
  lines.push(
    `Incremento por ciclo: piernas +${formatWeight(config.incLowerKg)} kg, torso +${formatWeight(config.incUpperKg)} kg. RIR objetivo ${ctx.profile.target_rir}.`,
  );
  for (const lift of ctx.lifts) {
    const state = liftStateFrom(lift);
    const today = workingWeightKg(state, placement.week, phaseConfig);
    const flags = [
      state.hold
        ? `TOPE tras fallo: ${formatWeight(state.holdAtKg ?? 0)} kg (se aplica cuando la ola lo alcanza; en descarga manda la descarga)`
        : null,
      state.penalty > 0 ? `RM penalizada −${Math.round(state.penalty * 100)} %` : null,
      state.failCount > 0 ? `${state.failCount} fallo(s)` : null,
    ].filter(Boolean);
    lines.push(
      `- ${lift.name} (${lift.key}): RM ${formatWeight(state.e1rmKg)} kg → esta semana ${formatWeight(today)} kg${flags.length ? ` · ${flags.join(", ")}` : ""}`,
    );
  }
  return lines;
}

/** One block per slot; `withStructure` adds each run week's typed blocks. */
function slotLines(
  { ctx }: LoadedAthlete,
  phase: PhaseRow,
  withStructure: boolean,
): string[] {
  const lines: string[] = [];
  const slots = ctx.slots
    .filter((s) => s.phase_id === phase.id)
    .sort((a, b) => a.position - b.position);
  for (const slot of slots) {
    lines.push(
      `### ${slot.label} — ${slot.title} · ${slot.subtitle || "—"}  [slotId: ${slot.id}] [tipo: ${slot.session_type}]`,
    );
    const exercises = ctx.exercises
      .filter((e) => e.slot_id === slot.id)
      .sort((a, b) => a.position - b.position);
    if (exercises.length === 0) {
      const runs = ctx.prescriptions
        .filter((r) => r.slot_id === slot.id)
        .sort((a, b) => a.week - b.week);
      for (const r of runs) {
        lines.push(
          withStructure
            ? `  · sem ${r.week}: ${r.prescription}${r.notes ? ` (${r.notes})` : ""}  [structure: ${JSON.stringify(r.structure)}]`
            : `  · sem ${r.week}: ${r.prescription}`,
        );
      }
      if (runs.length === 0) lines.push("  · sin contenido");
      continue;
    }
    for (const e of exercises) {
      const reps = e.rep_min === e.rep_max ? `${e.rep_min}` : `${e.rep_min}-${e.rep_max}`;
      lines.push(
        `  - ${e.name} · ${e.sets} × ${reps} · desc. ${restLabel(e.rest_seconds)}${
          e.is_primary ? " · BÁSICO (dispara la regresión)" : ""
        }${e.lift_key ? ` · liftKey ${e.lift_key}` : ""}  [exerciseId: ${e.id}]`,
      );
    }
    const totalSets = exercises.reduce((acc, e) => acc + e.sets, 0);
    lines.push(
      `  (total ${totalSets} series ≈ ${Math.round(totalSets * 3.1 + 12)} minutos)`,
    );
  }
  return lines;
}

function weekLines(ctx: LoadedAthlete["ctx"], phase: PhaseRow): string[] {
  const slots = ctx.slots.filter((s) => s.phase_id === phase.id);
  return ctx.days
    .filter((d) => d.phase_id === phase.id)
    .sort((a, b) => a.day_index - b.day_index)
    .map((day) => {
      const slot = slots.find((s) => s.id === day.slot_id);
      return `- ${DAY_LABELS[day.day_index]} (dayIndex ${day.day_index}): ${slot?.title ?? "—"} [slotId: ${slot?.id ?? "—"}]`;
    });
}
