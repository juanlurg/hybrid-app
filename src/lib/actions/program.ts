"use server";

import { revalidatePath } from "next/cache";

import { loadAthlete } from "@/lib/data/athlete";
import { createClient } from "@/lib/supabase/server";
import { formatWeight, roundToStep } from "@/lib/engine";
import { seedWeightKg, TIMED_SLUGS } from "@/lib/domain/catalog";
import type { Database } from "@/lib/supabase/database.types";

type Result = { ok: boolean; error?: string };
type LoadMode = Database["public"]["Enums"]["load_mode"];

async function guard() {
  const athlete = await loadAthlete();
  if (!athlete) return null;
  return athlete;
}

/** Slot ids the athlete owns — the authorisation check for every edit. */
function ownsSlot(
  athlete: NonNullable<Awaited<ReturnType<typeof loadAthlete>>>,
  slotId: string,
) {
  return athlete.ctx.slots.some((s) => s.id === slotId);
}

export async function setExerciseSets(
  exerciseId: string,
  delta: number,
): Promise<Result> {
  const athlete = await guard();
  if (!athlete) return { ok: false, error: "Sin sesión iniciada." };
  const row = athlete.ctx.exercises.find((e) => e.id === exerciseId);
  if (!row) return { ok: false, error: "Ejercicio no encontrado." };

  const next = Math.max(1, Math.min(12, row.sets + delta));
  const supabase = await createClient();
  const { error } = await supabase
    .from("program_exercises")
    .update({ sets: next })
    .eq("id", exerciseId);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function updateExercise(
  exerciseId: string,
  patch: {
    name?: string;
    sets?: number;
    repMin?: number;
    repMax?: number;
    restSeconds?: number;
    notes?: string;
    loadMode?: LoadMode;
    fixedWeightKg?: number | null;
  },
): Promise<Result> {
  const athlete = await guard();
  if (!athlete) return { ok: false, error: "Sin sesión iniciada." };
  const row = athlete.ctx.exercises.find((e) => e.id === exerciseId);
  if (!row) return { ok: false, error: "Ejercicio no encontrado." };

  const repMin = patch.repMin ?? row.rep_min;
  const repMax = patch.repMax ?? row.rep_max;
  if (repMax < repMin) return { ok: false, error: "El rango de reps está invertido." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("program_exercises")
    .update({
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.sets !== undefined
        ? { sets: Math.max(1, Math.min(12, patch.sets)) }
        : {}),
      rep_min: repMin,
      rep_max: repMax,
      ...(patch.restSeconds !== undefined
        ? { rest_seconds: Math.max(0, patch.restSeconds) }
        : {}),
      ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
      ...(patch.loadMode !== undefined ? { load_mode: patch.loadMode } : {}),
      ...(patch.fixedWeightKg !== undefined
        ? { fixed_weight_kg: patch.fixedWeightKg }
        : {}),
    })
    .eq("id", exerciseId);

  if (error) return { ok: false, error: error.message };
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function moveExercise(
  exerciseId: string,
  direction: -1 | 1,
): Promise<Result> {
  const athlete = await guard();
  if (!athlete) return { ok: false, error: "Sin sesión iniciada." };
  const row = athlete.ctx.exercises.find((e) => e.id === exerciseId);
  if (!row) return { ok: false, error: "Ejercicio no encontrado." };

  const siblings = athlete.ctx.exercises
    .filter((e) => e.slot_id === row.slot_id)
    .sort((a, b) => a.position - b.position);
  const index = siblings.findIndex((e) => e.id === exerciseId);
  const target = index + direction;
  if (target < 0 || target >= siblings.length) return { ok: true };

  const other = siblings[target];
  const supabase = await createClient();

  // Park one row out of the way: (slot_id, position) has no unique index,
  // but keeping positions distinct keeps the ordering stable.
  await supabase
    .from("program_exercises")
    .update({ position: -1 })
    .eq("id", row.id);
  await supabase
    .from("program_exercises")
    .update({ position: row.position })
    .eq("id", other.id);
  const { error } = await supabase
    .from("program_exercises")
    .update({ position: other.position })
    .eq("id", row.id);

  if (error) return { ok: false, error: error.message };
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function deleteExercise(exerciseId: string): Promise<Result> {
  const athlete = await guard();
  if (!athlete) return { ok: false, error: "Sin sesión iniciada." };
  const row = athlete.ctx.exercises.find((e) => e.id === exerciseId);
  if (!row) return { ok: false, error: "Ejercicio no encontrado." };
  if (row.is_primary)
    return {
      ok: false,
      error:
        "El básico del día no se puede borrar: es lo que dispara la regla de regresión. Cámbialo por otro ejercicio.",
    };

  const supabase = await createClient();
  const { error } = await supabase
    .from("program_exercises")
    .delete()
    .eq("id", exerciseId);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function addExercise(
  slotId: string,
  input?: { name?: string; exerciseId?: string | null },
): Promise<Result> {
  const athlete = await guard();
  if (!athlete) return { ok: false, error: "Sin sesión iniciada." };
  if (!ownsSlot(athlete, slotId)) return { ok: false, error: "Sesión no encontrada." };

  const siblings = athlete.ctx.exercises.filter((e) => e.slot_id === slotId);
  const position = siblings.reduce((max, e) => Math.max(max, e.position), 0) + 1;

  const supabase = await createClient();

  // From the catalogue: the row carries its own load mode, equipment and
  // rest, and gets a rackable starting weight instead of a "—".
  if (input?.exerciseId) {
    const { data: cat } = await supabase
      .from("exercises")
      .select("id, slug, name, modality, equipment, default_rest_seconds")
      .eq("id", input.exerciseId)
      .maybeSingle();
    if (!cat) return { ok: false, error: "Ejercicio no encontrado en el catálogo." };

    const fixed =
      cat.modality === "fixed"
        ? seedWeightKg(cat.equipment, athlete.config)
        : cat.modality === "weighted_bodyweight"
          ? 0
          : null;

    const { error } = await supabase.from("program_exercises").insert({
      slot_id: slotId,
      position,
      exercise_id: cat.id,
      name: input.name ?? cat.name,
      sets: 3,
      rep_min: 8,
      rep_max: 10,
      rest_seconds: cat.default_rest_seconds,
      load_mode: cat.modality,
      fixed_weight_kg: fixed,
      effort: TIMED_SLUGS.has(cat.slug) ? "seconds" : "reps",
      equipment: cat.equipment,
    });
    if (error) return { ok: false, error: error.message };
    revalidatePath("/", "layout");
    return { ok: true };
  }

  const { error } = await supabase.from("program_exercises").insert({
    slot_id: slotId,
    position,
    exercise_id: null,
    name: input?.name ?? "Ejercicio nuevo",
    sets: 3,
    rep_min: 8,
    rep_max: 10,
    rest_seconds: 90,
    load_mode: "fixed",
    fixed_weight_kg: 10,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/", "layout");
  return { ok: true };
}

/** Point a weekday at a different slot. */
export async function setDaySlot(
  phaseId: string,
  dayIndex: number,
  slotId: string,
): Promise<Result> {
  const athlete = await guard();
  if (!athlete) return { ok: false, error: "Sin sesión iniciada." };
  if (!ownsSlot(athlete, slotId)) return { ok: false, error: "Sesión no encontrada." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("program_days")
    .upsert(
      { phase_id: phaseId, day_index: dayIndex, slot_id: slotId },
      { onConflict: "phase_id,day_index" },
    );
  if (error) return { ok: false, error: error.message };
  revalidatePath("/", "layout");
  return { ok: true };
}

/**
 * Move the whole season N days in one call. The explicit rule this
 * implements: the calendar rules — missed days are lost; moving the
 * plan is a bulk shift, never a re-queue. Logged sessions keep their
 * real dates and the race day does not move.
 */
export async function shiftProgram(days: number): Promise<Result> {
  const athlete = await guard();
  if (!athlete) return { ok: false, error: "Sin sesión iniciada." };
  if (!Number.isInteger(days) || days === 0 || Math.abs(days) > 90) {
    return { ok: false, error: "Indica entre 1 y 90 días, hacia delante o atrás." };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("shift_program", {
    p_program_id: athlete.ctx.program.id,
    p_days: days,
  });
  if (error) return { ok: false, error: error.message };

  revalidatePath("/", "layout");
  return { ok: true };
}

/**
 * Nudge one step of the wave. The editor DISPLAYS the phase-resolved
 * wave (phaseEngineConfig), so the write must target the same scope:
 * a phase with its own wave override (F0 today) edits that phase's
 * wave; only phases riding the program default edit programs.wave.
 * Fixed-% phases have no wave to edit at all.
 */
export async function setWaveStep(index: number, delta: number): Promise<Result> {
  const athlete = await guard();
  if (!athlete) return { ok: false, error: "Sin sesión iniciada." };

  const phase = athlete.ctx.phases.find(
    (p) => p.id === athlete.placement.phase.id,
  );
  if (phase?.progression_mode === "fixed_pct") {
    return {
      ok: false,
      error: "Esta fase va a porcentaje fijo: no hay ola que editar.",
    };
  }
  const phaseWave = (phase?.wave ?? []).map(Number).filter((n) => n > 0);
  const wave = phaseWave.length
    ? phaseWave
    : (athlete.ctx.program.wave ?? []).map(Number);
  if (index < 0 || index >= wave.length) return { ok: false, error: "Paso inválido." };

  wave[index] = Math.max(
    0.5,
    Math.min(1, Math.round((wave[index] + delta) * 100) / 100),
  );

  const supabase = await createClient();
  const { error } = phaseWave.length
    ? await supabase
        .from("program_phases")
        .update({ wave })
        .eq("id", phase!.id)
    : await supabase
        .from("programs")
        .update({ wave })
        .eq("id", athlete.ctx.program.id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/", "layout");
  return { ok: true };
}

/** Manual RM correction from the Programa screen. */
export async function adjustLiftRm(
  liftId: string,
  deltaKg: number,
): Promise<Result> {
  const athlete = await guard();
  if (!athlete) return { ok: false, error: "Sin sesión iniciada." };
  const lift = athlete.ctx.lifts.find((l) => l.id === liftId);
  if (!lift) return { ok: false, error: "Ejercicio no encontrado." };

  const next = Math.max(
    athlete.config.barKg,
    roundToStep(Number(lift.e1rm_kg) + deltaKg, athlete.config.roundingKg),
  );

  const supabase = await createClient();
  // Like the re-test path: a hand-set RM overrides the engine's opinion,
  // so the penalty/hold machinery resets with it — otherwise "los pesos
  // futuros se recalculan" from a state the athlete just corrected.
  const { error } = await supabase
    .from("lifts")
    .update({
      e1rm_kg: next,
      penalty: 0,
      fail_count: 0,
      hold: false,
      hold_at_kg: null,
    })
    .eq("id", liftId);
  if (error) return { ok: false, error: error.message };

  await supabase.from("engine_events").insert({
    user_id: athlete.userId,
    program_id: athlete.ctx.program.id,
    lift_id: liftId,
    week: athlete.placement.absoluteWeek,
    kind: "manual_rm",
    title: `${lift.name} · RM ajustada a mano`,
    detail: `${formatWeight(Number(lift.e1rm_kg))} kg → ${formatWeight(next)} kg. La ola se recalcula con la RM nueva; el contador de fallos vuelve a cero y el peso deja de estar en espera. Los pesos ya registrados no cambian.`,
  });

  revalidatePath("/", "layout");
  return { ok: true };
}

/** Record a test result and, when it is an RM re-test, resync the lift. */
export async function recordMeasurement(input: {
  kind: Database["public"]["Enums"]["measurement_kind"];
  takenOn: string;
  label?: string;
  value?: number | null;
  unit?: string;
  liftId?: string | null;
  notes?: string;
}): Promise<Result> {
  const athlete = await guard();
  if (!athlete) return { ok: false, error: "Sin sesión iniciada." };
  const supabase = await createClient();

  const { error } = await supabase.from("measurements").insert({
    user_id: athlete.userId,
    kind: input.kind,
    taken_on: input.takenOn,
    label: input.label ?? "",
    value: input.value ?? null,
    unit: input.unit ?? "",
    notes: input.notes ?? "",
    payload: input.liftId ? { lift_id: input.liftId } : {},
  });
  if (error) return { ok: false, error: error.message };

  if (input.kind === "lthr" && input.value) {
    await supabase
      .from("profiles")
      .update({ lthr: Math.round(input.value) })
      .eq("id", athlete.userId);
    await supabase.from("engine_events").insert({
      user_id: athlete.userId,
      program_id: athlete.ctx.program.id,
      week: athlete.placement.absoluteWeek,
      kind: "lthr_test",
      title: `Test de LTHR · ${Math.round(input.value)} ppm`,
      detail: `Zonas recalculadas. Z2 pasa a ${Math.round(input.value * 0.81)}–${Math.round(input.value * 0.89)} ppm.`,
    });
  }

  if (
    input.kind === "rm_estimate" &&
    input.value &&
    input.liftId &&
    athlete.ctx.profile.sync_rm_after_retest
  ) {
    const rounded = roundToStep(input.value, athlete.config.roundingKg);
    await supabase
      .from("lifts")
      .update({ e1rm_kg: rounded, penalty: 0, fail_count: 0, hold: false, hold_at_kg: null })
      .eq("id", input.liftId);
    await supabase.from("engine_events").insert({
      user_id: athlete.userId,
      program_id: athlete.ctx.program.id,
      lift_id: input.liftId,
      week: athlete.placement.absoluteWeek,
      kind: "rm_retest",
      title: `Re-test de RM · ${formatWeight(rounded)} kg`,
      detail:
        "La ola se reconstruye con la RM nueva y el contador de fallos vuelve a cero.",
    });
  }

  revalidatePath("/", "layout");
  return { ok: true };
}
