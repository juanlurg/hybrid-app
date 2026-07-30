import type { LoadedAthlete } from "@/lib/data/athlete";
import { DAY_LABELS } from "@/lib/domain/calendar";
import { formatWeight, workingWeightKg } from "@/lib/engine";
import {
  liftStateFrom,
  phaseEngineConfig,
  restLabel,
  type PhaseRow,
} from "@/lib/domain/plan";

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
  const { ctx, config, placement } = athlete;
  const phaseConfig = phaseEngineConfig(config, phase);
  const slots = ctx.slots
    .filter((s) => s.phase_id === phase.id)
    .sort((a, b) => a.position - b.position);
  const days = ctx.days
    .filter((d) => d.phase_id === phase.id)
    .sort((a, b) => a.day_index - b.day_index);
  const lines: string[] = [];

  lines.push(`# Programa: ${ctx.program.name}`);
  lines.push(`Objetivo: ${ctx.program.goal || "sin objetivo declarado"}`);
  if (ctx.program.race_on) {
    lines.push(
      `Carrera objetivo: ${ctx.program.race_name ?? "carrera"} el ${ctx.program.race_on}.`,
    );
  }
  lines.push(
    `Hoy es ${athlete.today}. Fase actual ${phase.key} — ${phase.name}, semana ${placement.week} de ${phase.weeks} (semana ${placement.absoluteWeek} de ${athlete.seasonWeeks} de la temporada).`,
  );
  lines.push(
    `Énfasis de la fase: ${phase.emphasis || "—"}. Notas: ${phase.notes || "—"}`,
  );
  lines.push("");

  lines.push("## Motor de pesos (sólo lectura para ti)");
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
  lines.push("");

  lines.push("## Sesiones tipo de la fase (slots)");
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
        lines.push(`  · sem ${r.week}: ${r.prescription}`);
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
  lines.push("");

  lines.push("## Semana tipo");
  for (const day of days) {
    const slot = slots.find((s) => s.id === day.slot_id);
    lines.push(
      `- ${DAY_LABELS[day.day_index]} (dayIndex ${day.day_index}): ${slot?.title ?? "—"} [slotId: ${slot?.id ?? "—"}]`,
    );
  }

  return lines.join("\n");
}
