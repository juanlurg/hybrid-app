"use server";

import { revalidatePath } from "next/cache";

import { loadAthlete, type LoadedAthlete } from "@/lib/data/athlete";
import { createClient } from "@/lib/supabase/server";
import {
  generateJson,
  hasGeminiKey,
  geminiModel,
  MissingApiKeyError,
} from "@/lib/ai/gemini";
import {
  BUILDER_SYSTEM_INSTRUCTION,
  COACH_SYSTEM_INSTRUCTION,
  buildCatalogContext,
  buildPlanContext,
} from "@/lib/ai/prompt";
import {
  changeOpSchema,
  generatedProgramSchema,
  programJsonSchema,
  proposalJsonSchema,
  proposalSchema,
  type ChangeOp,
} from "@/lib/ai/schema";
import { seedWeightKg, TIMED_SLUGS } from "@/lib/domain/catalog";
import { planWarnings } from "@/lib/domain/plan-rules";
import type { Database } from "@/lib/supabase/database.types";
import type { ProgramExerciseRow } from "@/lib/domain/plan";
import { addDays, startOfWeek, todayIso } from "@/lib/domain/calendar";
import type { z } from "zod";

type SupabaseServer = Awaited<ReturnType<typeof createClient>>;

/* ── catalogue ───────────────────────────────────────────────── */

interface CatalogRow {
  id: string;
  slug: string;
  name: string;
  modality: Database["public"]["Enums"]["load_mode"];
  equipment: Database["public"]["Enums"]["equipment_kind"];
  default_rest_seconds: number;
  pattern: string | null;
}

/** The exercises this athlete can actually rack, keyed by slug. */
async function loadCatalog(
  supabase: SupabaseServer,
  available: readonly string[],
): Promise<Map<string, CatalogRow>> {
  const { data } = await supabase
    .from("exercises")
    .select("id, slug, name, modality, equipment, default_rest_seconds, pattern")
    .order("name");
  const rows = (data ?? []).filter((c) =>
    available.includes(String(c.equipment)),
  );
  return new Map(rows.map((r) => [r.slug, r as CatalogRow]));
}

/* ── one repair retry ────────────────────────────────────────── */

/**
 * One structured call plus, if the output does not validate, exactly
 * one repair round with the validation errors quoted back. Two model
 * calls maximum — never a loop.
 */
async function generateWithRepair<S extends z.ZodTypeAny>(
  opts: {
    systemInstruction: string;
    contents: Array<{ role: "user" | "model"; text: string }>;
    jsonSchema: unknown;
    temperature?: number;
    maxOutputTokens?: number;
  },
  schema: S,
): Promise<{ data: z.infer<S>; usage: Record<string, number> } | { error: string }> {
  let firstError: string;
  try {
    const { data, usage } = await generateJson(opts);
    const parsed = schema.safeParse(data);
    if (parsed.success) return { data: parsed.data, usage };
    firstError = parsed.error.issues
      .slice(0, 5)
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
  } catch (cause) {
    if (cause instanceof MissingApiKeyError) throw cause;
    firstError = cause instanceof Error ? cause.message : "respuesta ilegible";
  }

  try {
    const { data, usage } = await generateJson({
      ...opts,
      contents: [
        ...opts.contents,
        {
          role: "user",
          text:
            `Tu respuesta anterior no validó (${firstError}). ` +
            `Devuelve SOLO el JSON corregido, con el mismo esquema.`,
        },
      ],
    });
    const parsed = schema.safeParse(data);
    if (parsed.success) return { data: parsed.data, usage };
    return {
      error:
        "La propuesta de la IA no encaja con el formato ni tras reintentarlo. Prueba a reformular la pregunta.",
    };
  } catch (cause) {
    if (cause instanceof MissingApiKeyError) throw cause;
    return {
      error: cause instanceof Error ? cause.message : "Error inesperado.",
    };
  }
}

type Json = Database["public"]["Tables"]["ai_proposals"]["Row"]["changes"];

export interface ProposalView {
  id: string;
  question: string;
  rationale: string;
  changes: ChangeOp[];
  status: Database["public"]["Enums"]["ai_proposal_status"];
}

export interface ProposeResult {
  ok: boolean;
  error?: string;
  needsApiKey?: boolean;
  proposal?: ProposalView;
  threadId?: string;
}

/* ── snapshot ────────────────────────────────────────────────── */

interface PlanSnapshot {
  phaseId: string;
  wave: number[];
  exercises: ProgramExerciseRow[];
  days: Array<{ day_index: number; slot_id: string }>;
}

function snapshotOf(athlete: LoadedAthlete, phaseId: string): PlanSnapshot {
  const slotIds = new Set(
    athlete.ctx.slots.filter((s) => s.phase_id === phaseId).map((s) => s.id),
  );
  return {
    phaseId,
    wave: (athlete.ctx.program.wave ?? []).map(Number),
    exercises: athlete.ctx.exercises.filter((e) => slotIds.has(e.slot_id)),
    days: athlete.ctx.days
      .filter((d) => d.phase_id === phaseId)
      .map((d) => ({ day_index: d.day_index, slot_id: d.slot_id })),
  };
}

/** Exact restore: ids and all, so anything referencing them still resolves. */
async function restoreSnapshot(
  supabase: SupabaseServer,
  athlete: LoadedAthlete,
  snapshot: PlanSnapshot,
): Promise<void> {
  const slotIds = athlete.ctx.slots
    .filter((s) => s.phase_id === snapshot.phaseId)
    .map((s) => s.id);

  if (slotIds.length > 0) {
    await supabase.from("program_exercises").delete().in("slot_id", slotIds);
  }
  if (snapshot.exercises.length > 0) {
    await supabase.from("program_exercises").insert(snapshot.exercises);
  }
  for (const day of snapshot.days) {
    await supabase.from("program_days").upsert(
      {
        phase_id: snapshot.phaseId,
        day_index: day.day_index,
        slot_id: day.slot_id,
      },
      { onConflict: "phase_id,day_index" },
    );
  }
  await supabase
    .from("programs")
    .update({ wave: snapshot.wave })
    .eq("id", athlete.ctx.program.id);
}

/**
 * The ownership/sanity filter, shared by propose AND apply: apply must
 * re-check because the plan can change between the two. Drops anything
 * that points outside this athlete's phase, names an exercise off the
 * catalogue, or touches the regression trigger (the primary).
 */
function filterOwnedChanges(
  changes: ChangeOp[],
  athlete: LoadedAthlete,
  phaseId: string,
  catalog: Map<string, CatalogRow>,
): ChangeOp[] {
  const validSlots = new Set(
    athlete.ctx.slots.filter((s) => s.phase_id === phaseId).map((s) => s.id),
  );
  const exercisesById = new Map(
    athlete.ctx.exercises
      .filter((e) => validSlots.has(e.slot_id))
      .map((e) => [e.id, e]),
  );

  return changes.filter((c) => {
    if (c.exerciseId && !exercisesById.has(c.exerciseId)) return false;
    if (c.slotId && !validSlots.has(c.slotId)) return false;
    if (c.targetSlotId && !validSlots.has(c.targetSlotId)) return false;
    if (
      (c.op === "add_exercise" || c.op === "rename_exercise") &&
      (!c.exerciseSlug || !catalog.has(c.exerciseSlug))
    ) {
      return false;
    }
    // Never let a proposal orphan or mutate the regression trigger.
    if (
      (c.op === "remove_exercise" ||
        c.op === "move_exercise" ||
        c.op === "rename_exercise") &&
      c.exerciseId &&
      exercisesById.get(c.exerciseId)?.is_primary
    ) {
      return false;
    }
    return true;
  });
}

/* ── propose ─────────────────────────────────────────────────── */

export async function proposeChanges(
  question: string,
  threadId?: string,
): Promise<ProposeResult> {
  const athlete = await loadAthlete();
  if (!athlete) return { ok: false, error: "Sin sesión iniciada." };
  const trimmed = question.trim();
  if (!trimmed) return { ok: false, error: "Escribe qué quieres cambiar." };
  if (!hasGeminiKey()) {
    return {
      ok: false,
      needsApiKey: true,
      error: new MissingApiKeyError().message,
    };
  }

  const supabase = await createClient();
  const phase = athlete.ctx.phases.find(
    (p) => p.id === athlete.placement.phase.id,
  );
  if (!phase) return { ok: false, error: "No hay fase activa." };

  // Thread + prior turns, so follow-ups keep their context.
  let thread = threadId ?? null;
  if (!thread) {
    const { data } = await supabase
      .from("ai_threads")
      .insert({
        user_id: athlete.userId,
        program_id: athlete.ctx.program.id,
        title: trimmed.slice(0, 80),
      })
      .select("id")
      .single();
    thread = data?.id ?? null;
  }
  if (!thread) return { ok: false, error: "No se ha podido abrir la conversación." };

  const { data: history } = await supabase
    .from("ai_messages")
    .select("role, content")
    .eq("thread_id", thread)
    .order("created_at")
    .limit(12);

  await supabase.from("ai_messages").insert({
    thread_id: thread,
    user_id: athlete.userId,
    role: "user",
    content: trimmed,
  });

  const catalog = await loadCatalog(
    supabase,
    (athlete.ctx.profile.available_equipment ?? []).map(String),
  );
  const planContext = buildPlanContext(athlete, phase);
  const catalogContext = buildCatalogContext(
    [...catalog.values()].map((c) => ({
      slug: c.slug,
      name: c.name,
      equipment: String(c.equipment),
      pattern: c.pattern,
    })),
  );

  const contents: Array<{ role: "user" | "model"; text: string }> = [
    {
      role: "user",
      text: `Este es mi plan ahora mismo:\n\n${planContext}\n\n${catalogContext}`,
    },
    {
      role: "model",
      text: "Entendido. Tengo el plan, el estado del motor y el catálogo. Dime qué quieres cambiar.",
    },
    ...(history ?? [])
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => ({
        role: (m.role === "user" ? "user" : "model") as "user" | "model",
        text: m.content,
      })),
    { role: "user", text: trimmed },
  ];

  let parsed;
  try {
    const result = await generateWithRepair(
      {
        systemInstruction: COACH_SYSTEM_INSTRUCTION,
        contents,
        jsonSchema: proposalJsonSchema([...catalog.keys()]),
      },
      proposalSchema,
    );
    if ("error" in result) return { ok: false, error: result.error };
    parsed = { ...result.data, usage: result.usage };
  } catch (cause) {
    return {
      ok: false,
      error: cause instanceof Error ? cause.message : "Error inesperado.",
      needsApiKey: cause instanceof MissingApiKeyError,
    };
  }

  const changes = filterOwnedChanges(parsed.changes, athlete, phase.id, catalog);

  const { data: message } = await supabase
    .from("ai_messages")
    .insert({
      thread_id: thread,
      user_id: athlete.userId,
      role: "assistant",
      content: parsed.rationale,
      meta: { model: geminiModel(), ...parsed.usage },
    })
    .select("id")
    .single();

  const { data: proposal, error } = await supabase
    .from("ai_proposals")
    .insert({
      thread_id: thread,
      message_id: message?.id ?? null,
      user_id: athlete.userId,
      program_id: athlete.ctx.program.id,
      phase_id: phase.id,
      question: trimmed,
      rationale: parsed.rationale,
      changes: changes as unknown as Json,
      status: "pending",
    })
    .select("id, status")
    .single();

  if (error) return { ok: false, error: error.message };

  revalidatePath("/editor");
  return {
    ok: true,
    threadId: thread,
    proposal: {
      id: proposal.id,
      question: trimmed,
      rationale: parsed.rationale,
      changes,
      status: proposal.status,
    },
  };
}

/* ── apply ───────────────────────────────────────────────────── */

export async function applyProposal(
  proposalId: string,
  acceptedIndices: number[],
): Promise<{ ok: boolean; error?: string; applied?: number }> {
  const athlete = await loadAthlete();
  if (!athlete) return { ok: false, error: "Sin sesión iniciada." };
  const supabase = await createClient();

  const { data: proposal } = await supabase
    .from("ai_proposals")
    .select("*")
    .eq("id", proposalId)
    .eq("user_id", athlete.userId)
    .maybeSingle();
  if (!proposal) return { ok: false, error: "Propuesta no encontrada." };
  if (proposal.status !== "pending")
    return { ok: false, error: "Esa propuesta ya se ha resuelto." };

  const allChanges = Array.isArray(proposal.changes)
    ? (proposal.changes as unknown[])
    : [];
  const parsed = acceptedIndices
    .filter((i) => i >= 0 && i < allChanges.length)
    .map((i) => changeOpSchema.safeParse(allChanges[i]))
    .filter((r) => r.success)
    .map((r) => r.data);

  const phaseId = proposal.phase_id ?? athlete.placement.phase.id;
  const catalog = await loadCatalog(
    supabase,
    (athlete.ctx.profile.available_equipment ?? []).map(String),
  );
  // The plan can have changed since propose: re-run the same filter.
  const accepted = filterOwnedChanges(parsed, athlete, phaseId, catalog);

  if (accepted.length === 0)
    return { ok: false, error: "No has seleccionado ningún cambio aplicable." };

  const snapshot = snapshotOf(athlete, phaseId);

  const positionOf = (slotId: string) => {
    const rows = athlete.ctx.exercises.filter((e) => e.slot_id === slotId);
    return rows.reduce((max, e) => Math.max(max, e.position), 0) + 1;
  };

  // set_wave ops accumulate on this copy — two in one batch both land.
  const wave = [...snapshot.wave];
  let waveTouched = false;

  let appliedCount = 0;
  const failures: string[] = [];

  for (const op of accepted) {
    let error: { message: string } | null = null;

    switch (op.op) {
      case "remove_exercise": {
        ({ error } = await supabase
          .from("program_exercises")
          .delete()
          .eq("id", op.exerciseId!)
          .eq("is_primary", false));
        break;
      }

      case "add_exercise": {
        const cat = catalog.get(op.exerciseSlug!)!;
        ({ error } = await supabase.from("program_exercises").insert({
          slot_id: op.slotId!,
          position: positionOf(op.slotId!),
          exercise_id: cat.id,
          name: op.name ?? cat.name,
          sets: op.sets ?? 3,
          rep_min: op.repMin ?? 8,
          rep_max: op.repMax ?? 10,
          rest_seconds: op.restSeconds ?? cat.default_rest_seconds,
          load_mode: cat.modality,
          equipment: cat.equipment,
          effort: TIMED_SLUGS.has(cat.slug) ? "seconds" : "reps",
          fixed_weight_kg:
            cat.modality === "fixed"
              ? seedWeightKg(cat.equipment, athlete.config)
              : cat.modality === "weighted_bodyweight"
                ? 0
                : null,
          notes: op.why ?? "",
        }));
        break;
      }

      case "move_exercise": {
        ({ error } = await supabase
          .from("program_exercises")
          .update({
            slot_id: op.targetSlotId!,
            position: positionOf(op.targetSlotId!),
          })
          .eq("id", op.exerciseId!));
        break;
      }

      case "rename_exercise": {
        // A rename is a catalogue substitution: id, equipment and load
        // mode follow the new exercise, the scheme stays.
        const cat = catalog.get(op.exerciseSlug!)!;
        ({ error } = await supabase
          .from("program_exercises")
          .update({
            name: op.name ?? cat.name,
            exercise_id: cat.id,
            equipment: cat.equipment,
            load_mode: cat.modality,
            effort: TIMED_SLUGS.has(cat.slug) ? "seconds" : "reps",
          })
          .eq("id", op.exerciseId!)
          .eq("is_primary", false));
        break;
      }

      case "set_sets": {
        ({ error } = await supabase
          .from("program_exercises")
          .update({ sets: op.sets! })
          .eq("id", op.exerciseId!));
        break;
      }

      case "set_reps": {
        ({ error } = await supabase
          .from("program_exercises")
          .update({ rep_min: op.repMin!, rep_max: op.repMax! })
          .eq("id", op.exerciseId!));
        break;
      }

      case "set_rest": {
        ({ error } = await supabase
          .from("program_exercises")
          .update({ rest_seconds: op.restSeconds! })
          .eq("id", op.exerciseId!));
        break;
      }

      case "set_day_slot": {
        ({ error } = await supabase.from("program_days").upsert(
          {
            phase_id: phaseId,
            day_index: op.dayIndex!,
            slot_id: op.slotId!,
          },
          { onConflict: "phase_id,day_index" },
        ));
        break;
      }

      case "set_wave": {
        if (op.waveIndex! < wave.length) {
          wave[op.waveIndex!] = op.waveValue!;
          waveTouched = true;
        }
        break;
      }

      case "note":
        // Advisory only — recorded in the timeline, changes nothing.
        break;
    }

    if (error) {
      failures.push(`${op.title}: ${error.message}`);
      continue;
    }

    appliedCount += 1;
    await supabase.from("engine_events").insert({
      user_id: athlete.userId,
      program_id: athlete.ctx.program.id,
      week: athlete.placement.week,
      kind: "ai_change",
      title: op.title,
      detail: `${op.from || "—"} → ${op.to || "—"}${op.why ? ` · ${op.why}` : ""}`,
      payload: { proposal_id: proposalId, op: op.op },
    });
  }

  if (waveTouched && failures.length === 0) {
    const { error } = await supabase
      .from("programs")
      .update({ wave })
      .eq("id", athlete.ctx.program.id);
    if (error) failures.push(`Ola: ${error.message}`);
  }

  if (failures.length > 0) {
    await restoreSnapshot(supabase, athlete, snapshot);
    return {
      ok: false,
      error: `No se ha aplicado nada — algo falló a mitad y el plan ha vuelto a como estaba. (${failures[0]})`,
    };
  }

  // Sanity rules over the plan as it now stands. A batch that leaves a
  // blocking violation is rolled back whole: the AI proposes, the rules
  // dispose.
  const slotIds = athlete.ctx.slots
    .filter((s) => s.phase_id === phaseId)
    .map((s) => s.id);
  const [{ data: freshExercises }, { data: freshDays }] = await Promise.all([
    slotIds.length
      ? supabase
          .from("program_exercises")
          .select("slot_id, sets, is_primary")
          .in("slot_id", slotIds)
      : Promise.resolve({ data: [] as Array<{ slot_id: string; sets: number; is_primary: boolean }> }),
    supabase
      .from("program_days")
      .select("day_index, slot_id")
      .eq("phase_id", phaseId),
  ]);

  const blocking = planWarnings({
    slots: athlete.ctx.slots
      .filter((s) => s.phase_id === phaseId)
      .map((s) => ({ id: s.id, label: s.label, sessionType: s.session_type })),
    exercises: (freshExercises ?? []).map((e) => ({
      slotId: e.slot_id,
      sets: e.sets,
      isPrimary: e.is_primary,
    })),
    days: (freshDays ?? []).map((d) => ({
      dayIndex: d.day_index,
      slotId: d.slot_id,
    })),
  }).filter((w) => w.blocking);

  if (blocking.length > 0) {
    await restoreSnapshot(supabase, athlete, snapshot);
    return {
      ok: false,
      error: `El lote dejaría el plan en un estado inválido y se ha deshecho entero: ${blocking
        .map((w) => w.title)
        .join(" · ")}.`,
    };
  }

  await supabase
    .from("ai_proposals")
    .update({
      status: "applied",
      accepted_indices: acceptedIndices,
      snapshot: snapshot as unknown as Json,
      applied_at: new Date().toISOString(),
    })
    .eq("id", proposalId);

  if (proposal.thread_id) {
    await supabase.from("ai_messages").insert({
      thread_id: proposal.thread_id,
      user_id: athlete.userId,
      role: "assistant",
      content: `${appliedCount} ${appliedCount === 1 ? "cambio aplicado" : "cambios aplicados"}. El motor de pesos sigue igual: las RM y la regla de regresión no se han tocado. Queda registrado en el historial.`,
    });
  }

  revalidatePath("/", "layout");
  return { ok: true, applied: appliedCount };
}

export async function discardProposal(
  proposalId: string,
): Promise<{ ok: boolean; error?: string }> {
  const athlete = await loadAthlete();
  if (!athlete) return { ok: false, error: "Sin sesión iniciada." };
  const supabase = await createClient();
  const { error } = await supabase
    .from("ai_proposals")
    .update({ status: "discarded" })
    .eq("id", proposalId)
    .eq("user_id", athlete.userId)
    .eq("status", "pending");
  if (error) return { ok: false, error: error.message };
  revalidatePath("/editor");
  return { ok: true };
}

/* ── undo ────────────────────────────────────────────────────── */

export async function undoProposal(
  proposalId: string,
): Promise<{ ok: boolean; error?: string }> {
  const athlete = await loadAthlete();
  if (!athlete) return { ok: false, error: "Sin sesión iniciada." };
  const supabase = await createClient();

  const { data: proposal } = await supabase
    .from("ai_proposals")
    .select("*")
    .eq("id", proposalId)
    .eq("user_id", athlete.userId)
    .maybeSingle();
  if (!proposal) return { ok: false, error: "Propuesta no encontrada." };
  if (proposal.status !== "applied")
    return { ok: false, error: "Esa propuesta no está aplicada." };

  const snapshot = proposal.snapshot as unknown as PlanSnapshot | null;
  if (!snapshot) return { ok: false, error: "No hay copia previa que restaurar." };

  await restoreSnapshot(supabase, athlete, snapshot);

  await supabase
    .from("ai_proposals")
    .update({ status: "undone", undone_at: new Date().toISOString() })
    .eq("id", proposalId);

  await supabase
    .from("engine_events")
    .update({ reverted_at: new Date().toISOString() })
    .eq("user_id", athlete.userId)
    .eq("kind", "ai_change")
    .contains("payload", { proposal_id: proposalId });

  if (proposal.thread_id) {
    await supabase.from("ai_messages").insert({
      thread_id: proposal.thread_id,
      user_id: athlete.userId,
      role: "assistant",
      content: "Deshecho. El plan vuelve a como estaba.",
    });
  }

  revalidatePath("/", "layout");
  return { ok: true };
}

/* ── rebuild a whole program ─────────────────────────────────── */

export async function rebuildProgram(input: {
  brief: string;
  startsOn?: string;
}): Promise<{ ok: boolean; error?: string; needsApiKey?: boolean; programId?: string }> {
  const athlete = await loadAthlete();
  if (!athlete) return { ok: false, error: "Sin sesión iniciada." };
  const brief = input.brief.trim();
  if (brief.length < 20)
    return {
      ok: false,
      error:
        "Cuéntame algo más: objetivo, fecha, días disponibles y material. Con dos palabras no sale un plan.",
    };
  if (!hasGeminiKey())
    return { ok: false, needsApiKey: true, error: new MissingApiKeyError().message };

  const supabase = await createClient();
  const startsOn = input.startsOn || startOfWeek(todayIso());
  const catalog = await loadCatalog(
    supabase,
    (athlete.ctx.profile.available_equipment ?? []).map(String),
  );
  const catalogContext = buildCatalogContext(
    [...catalog.values()].map((c) => ({
      slug: c.slug,
      name: c.name,
      equipment: String(c.equipment),
      pattern: c.pattern,
    })),
  );

  let program;
  try {
    const result = await generateWithRepair(
      {
        systemInstruction: BUILDER_SYSTEM_INSTRUCTION,
        contents: [
          {
            role: "user",
            text:
              `${brief}\n\n` +
              `El plan arranca el lunes ${startsOn}. ` +
              `Material disponible: barra de ${athlete.config.barKg} kg, discos ${athlete.config.platesKg.join("/")} kg y lo que aparece en el catálogo.` +
              (athlete.ctx.profile.lthr
                ? ` LTHR conocido: ${athlete.ctx.profile.lthr} ppm.`
                : " El LTHR aún no está medido: mete un test de umbral en una semana de descarga.") +
              `\n\n${catalogContext}`,
          },
        ],
        jsonSchema: programJsonSchema([...catalog.keys()]),
        temperature: 0.5,
        maxOutputTokens: 32768,
      },
      generatedProgramSchema,
    );
    if ("error" in result) return { ok: false, error: result.error };
    program = result.data;
  } catch (cause) {
    return {
      ok: false,
      error: cause instanceof Error ? cause.message : "Error inesperado.",
      needsApiKey: cause instanceof MissingApiKeyError,
    };
  }

  // Slugs outside the catalogue are dropped (the JSON enum makes this
  // rare); every strength slot then needs exactly one basic.
  for (const phase of program.phases) {
    for (const slot of phase.slots) {
      slot.exercises = slot.exercises.filter((e) => catalog.has(e.exerciseSlug));
      if (slot.sessionType !== "strength") continue;
      const primaries = slot.exercises.filter((e) => e.isPrimary);
      if (primaries.length === 0 && slot.exercises.length > 0) {
        slot.exercises[0].isPrimary = true;
      } else if (primaries.length > 1) {
        primaries.slice(1).forEach((e) => (e.isPrimary = false));
      }
    }
  }

  const totalWeeks = program.phases.reduce((acc, p) => acc + p.weeks, 0);

  // Built INACTIVE and only promoted once every phase landed — a failure
  // mid-build must never leave a half-programme in charge.
  const { data: created, error: programError } = await supabase
    .from("programs")
    .insert({
      user_id: athlete.userId,
      name: program.name,
      goal: program.goal,
      summary: program.summary,
      starts_on: startsOn,
      ends_on: addDays(startsOn, totalWeeks * 7 - 1),
      wave: program.wave,
      cycle_weeks: program.wave.length,
      is_active: false,
      source: "ai",
    })
    .select("id")
    .single();

  if (programError || !created) {
    return { ok: false, error: programError?.message ?? "No se ha podido crear el programa." };
  }

  try {
    let offsetWeeks = 0;
    for (const [index, phase] of program.phases.entries()) {
      const { data: phaseRow, error: phaseError } = await supabase
        .from("program_phases")
        .insert({
          program_id: created.id,
          key: phase.key,
          name: phase.name,
          emphasis: phase.emphasis,
          position: index + 1,
          weeks: phase.weeks,
          starts_on: addDays(startsOn, offsetWeeks * 7),
          notes: phase.notes,
        })
        .select("id")
        .single();
      if (phaseError || !phaseRow) {
        throw new Error(phaseError?.message ?? `fase ${phase.key}`);
      }
      offsetWeeks += phase.weeks;

      const slotIdByKey = new Map<string, string>();
      for (const [sIndex, slot] of phase.slots.entries()) {
        const { data: slotRow, error: slotError } = await supabase
          .from("program_slots")
          .insert({
            phase_id: phaseRow.id,
            key: slot.key,
            session_type: slot.sessionType,
            label: slot.label,
            title: slot.title,
            subtitle: slot.subtitle,
            position: sIndex + 1,
          })
          .select("id")
          .single();
        if (slotError || !slotRow) {
          throw new Error(slotError?.message ?? `slot ${slot.key}`);
        }
        slotIdByKey.set(slot.key, slotRow.id);

        if (slot.exercises.length > 0) {
          const { error } = await supabase.from("program_exercises").insert(
            slot.exercises.map((e, i) => {
              const cat = catalog.get(e.exerciseSlug)!;
              const loadMode = e.liftKey ? "engine" : cat.modality;
              return {
                slot_id: slotRow.id,
                position: i + 1,
                exercise_id: cat.id,
                name: e.name ?? cat.name,
                tag: e.isPrimary ? "BÁSICO" : "",
                sets: e.sets,
                rep_min: e.repMin,
                rep_max: e.repMax,
                rest_seconds: e.restSeconds,
                is_primary: e.isPrimary,
                load_mode: loadMode,
                lift_key: e.liftKey ?? null,
                equipment: cat.equipment,
                effort: TIMED_SLUGS.has(cat.slug) ? "seconds" : "reps",
                fixed_weight_kg:
                  loadMode === "fixed"
                    ? seedWeightKg(cat.equipment, athlete.config)
                    : loadMode === "weighted_bodyweight"
                      ? 0
                      : null,
                notes: e.notes,
              };
            }),
          );
          if (error) throw new Error(error.message);
        }
      }

      const days = phase.days
        .filter((d) => slotIdByKey.has(d.slotKey))
        .map((d) => ({
          phase_id: phaseRow.id,
          day_index: d.dayIndex,
          slot_id: slotIdByKey.get(d.slotKey)!,
        }));
      if (days.length > 0) {
        const { error } = await supabase.from("program_days").insert(days);
        if (error) throw new Error(error.message);
      }

      const runs = phase.runs
        .filter((r) => slotIdByKey.has(r.slotKey) && r.week <= phase.weeks)
        .map((r) => ({
          phase_id: phaseRow.id,
          slot_id: slotIdByKey.get(r.slotKey)!,
          week: r.week,
          prescription: r.prescription,
          structure: (r.structure ?? null) as Json,
          target_minutes: r.targetMinutes ?? null,
          notes: r.notes,
        }));
      if (runs.length > 0) {
        const { error } = await supabase
          .from("program_run_sessions")
          .upsert(runs, { onConflict: "phase_id,slot_id,week" });
        if (error) throw new Error(error.message);
      }
    }
  } catch (cause) {
    // A half-built programme must not exist, let alone be active.
    await supabase.from("programs").delete().eq("id", created.id);
    return {
      ok: false,
      error: `No se ha podido construir el programa completo (${
        cause instanceof Error ? cause.message : "error"
      }). No se ha cambiado nada.`,
    };
  }

  // Everything landed: only now does the new programme take charge.
  await supabase
    .from("programs")
    .update({ is_active: false })
    .eq("user_id", athlete.userId)
    .eq("is_active", true);
  await supabase
    .from("programs")
    .update({ is_active: true })
    .eq("id", created.id);

  // Carry the athlete's tracked lifts over — the engine state is theirs,
  // not the plan's, and a new plan must not reset an RM.
  const liftKeys = new Set<string>(
    program.phases.flatMap((p) =>
      p.slots.flatMap((s) =>
        s.exercises.flatMap((e) => (e.liftKey ? [e.liftKey] : [])),
      ),
    ),
  );
  const existing = new Set(athlete.ctx.lifts.map((l) => l.key));
  const missing = [...liftKeys].filter((k) => !existing.has(k));
  if (missing.length > 0) {
    await supabase.from("lifts").insert(
      missing.map((key) => ({
        user_id: athlete.userId,
        key,
        name: key.charAt(0).toUpperCase() + key.slice(1),
        kind: (["sentadilla", "hipthrust", "rdl"].includes(key)
          ? "lower"
          : "upper") as "lower" | "upper",
        e1rm_kg: 60,
      })),
    );
  }

  await supabase.from("engine_events").insert({
    user_id: athlete.userId,
    program_id: created.id,
    week: 1,
    kind: "program_created",
    title: `Programa generado con IA · ${program.name}`,
    detail: `${program.phases.length} fases, ${totalWeeks} semanas. Arranca el ${startsOn}. Las RM que ya seguías se conservan.`,
    payload: { brief },
  });

  revalidatePath("/", "layout");
  return { ok: true, programId: created.id };
}
