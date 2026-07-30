"use server";

import { revalidatePath } from "next/cache";

import { loadAthlete, type LoadedAthlete } from "@/lib/data/athlete";
import { createClient } from "@/lib/supabase/server";
import {
  GeminiCallError,
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
import { newBlockingTitles, planWarnings } from "@/lib/domain/plan-rules";
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

/** Short Spanish copy for an API-level failure — never the raw SDK text. */
function geminiErrorCopy(error: GeminiCallError): string {
  if (error.status === 429) {
    return "Gemini está al límite de peticiones. Espera un minuto y vuelve a intentarlo.";
  }
  if (error.status != null && error.status >= 500) {
    return "Gemini no responde ahora mismo. Inténtalo en un rato.";
  }
  return "No hay respuesta de Gemini. Revisa la conexión e inténtalo de nuevo.";
}

/**
 * One structured call plus, if the OUTPUT does not validate, exactly
 * one repair round with the validation errors quoted back. Two model
 * calls maximum — never a loop, and never a retry against a transport
 * failure: a 429/5xx gets short Spanish copy, not a second call that
 * doubles the load on a service that just said no.
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
    if (cause instanceof GeminiCallError && cause.kind === "http") {
      return { error: geminiErrorCopy(cause) };
    }
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
    if (cause instanceof GeminiCallError && cause.kind === "http") {
      return { error: geminiErrorCopy(cause) };
    }
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
  /** Ops the rules filtered out, rendered as disabled cards with the why. */
  dropped: Array<{ op: ChangeOp; reason: string }>;
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
  /** Legacy snapshots stored programs.wave here, before the phase split. */
  wave?: number[];
  programWave?: number[];
  phaseWave?: number[] | null;
  exercises: ProgramExerciseRow[];
  days: Array<{ day_index: number; slot_id: string }>;
}

function snapshotOf(athlete: LoadedAthlete, phaseId: string): PlanSnapshot {
  const slotIds = new Set(
    athlete.ctx.slots.filter((s) => s.phase_id === phaseId).map((s) => s.id),
  );
  const phaseRow = athlete.ctx.phases.find((p) => p.id === phaseId) ?? null;
  return {
    phaseId,
    programWave: (athlete.ctx.program.wave ?? []).map(Number),
    phaseWave: phaseRow?.wave == null ? null : phaseRow.wave.map(Number),
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

  // Restore by DIFF, never delete-and-reinsert: deleting a
  // program_exercises row fires set_logs' ON DELETE SET NULL, and
  // re-inserting the same id does NOT bring those history links back.
  // Surviving rows are updated in place; only strays the snapshot lacks
  // are deleted.
  if (snapshot.exercises.length > 0) {
    await supabase
      .from("program_exercises")
      .upsert(snapshot.exercises, { onConflict: "id" });
  }
  if (slotIds.length > 0) {
    const keepIds = snapshot.exercises.map((e) => e.id);
    let strays = supabase
      .from("program_exercises")
      .delete()
      .in("slot_id", slotIds);
    if (keepIds.length > 0) {
      strays = strays.not("id", "in", `(${keepIds.join(",")})`);
    }
    await strays;
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
  {
    const keepDays = snapshot.days.map((d) => d.day_index);
    let strayDays = supabase
      .from("program_days")
      .delete()
      .eq("phase_id", snapshot.phaseId);
    if (keepDays.length > 0) {
      strayDays = strayDays.not("day_index", "in", `(${keepDays.join(",")})`);
    }
    await strayDays;
  }
  const programWave = snapshot.programWave ?? snapshot.wave;
  if (programWave) {
    await supabase
      .from("programs")
      .update({ wave: programWave })
      .eq("id", athlete.ctx.program.id);
  }
  if (snapshot.phaseWave !== undefined) {
    await supabase
      .from("program_phases")
      .update({ wave: snapshot.phaseWave })
      .eq("id", snapshot.phaseId);
  }
}

export interface DroppedChange {
  op: ChangeOp;
  reason: string;
}

/**
 * The ownership/sanity filter, shared by propose AND apply: apply must
 * re-check because the plan can change between the two. Drops anything
 * that points outside this athlete's phase, names an exercise off the
 * catalogue, or touches the regression trigger (the primary) — and says
 * WHY, so a change the rationale narrates never just vanishes.
 */
function filterOwnedChanges(
  changes: ChangeOp[],
  athlete: LoadedAthlete,
  phaseId: string,
  catalog: Map<string, CatalogRow>,
): { kept: ChangeOp[]; dropped: DroppedChange[] } {
  const validSlots = new Set(
    athlete.ctx.slots.filter((s) => s.phase_id === phaseId).map((s) => s.id),
  );
  const exercisesById = new Map(
    athlete.ctx.exercises
      .filter((e) => validSlots.has(e.slot_id))
      .map((e) => [e.id, e]),
  );

  const reasonFor = (c: ChangeOp): string | null => {
    if (c.exerciseId && !exercisesById.has(c.exerciseId)) {
      return "el ejercicio ya no está en esta fase del plan";
    }
    if (c.slotId && !validSlots.has(c.slotId)) {
      return "la sesión no pertenece a esta fase";
    }
    if (c.targetSlotId && !validSlots.has(c.targetSlotId)) {
      return "la sesión de destino no pertenece a esta fase";
    }
    if (
      (c.op === "add_exercise" || c.op === "rename_exercise") &&
      (!c.exerciseSlug || !catalog.has(c.exerciseSlug))
    ) {
      return "el ejercicio no está en el catálogo disponible";
    }
    // Never let a proposal orphan or mutate the regression trigger.
    if (
      (c.op === "remove_exercise" ||
        c.op === "move_exercise" ||
        c.op === "rename_exercise") &&
      c.exerciseId &&
      exercisesById.get(c.exerciseId)?.is_primary
    ) {
      return "el básico no se toca: es el que dispara la regresión";
    }
    return null;
  };

  const kept: ChangeOp[] = [];
  const dropped: DroppedChange[] = [];
  for (const c of changes) {
    const reason = reasonFor(c);
    if (reason) dropped.push({ op: c, reason });
    else kept.push(c);
  }
  return { kept, dropped };
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
    // The 12 NEWEST turns, oldest-first for the model — ascending with
    // limit() froze the model on the thread's opening messages forever.
    .order("created_at", { ascending: false })
    .limit(12);
  history?.reverse();

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

  const { kept: changes, dropped } = filterOwnedChanges(
    parsed.changes,
    athlete,
    phase.id,
    catalog,
  );

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
      dropped: dropped as unknown as Json,
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
      dropped,
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
    .map((i) => ({ index: i, result: changeOpSchema.safeParse(allChanges[i]) }))
    .filter((p) => p.result.success)
    .map((p) => ({ index: p.index, op: p.result.data! }));
  const indexByOp = new Map(parsed.map((p) => [p.op, p.index]));

  const phaseId = proposal.phase_id ?? athlete.placement.phase.id;
  const catalog = await loadCatalog(
    supabase,
    (athlete.ctx.profile.available_equipment ?? []).map(String),
  );
  // The plan can have changed since propose: re-run the same filter.
  const { kept: accepted, dropped: applyDropped } = filterOwnedChanges(
    parsed.map((p) => p.op),
    athlete,
    phaseId,
    catalog,
  );

  if (accepted.length === 0)
    return { ok: false, error: "No has seleccionado ningún cambio aplicable." };

  const snapshot = snapshotOf(athlete, phaseId);

  // In-memory high-water mark: two adds into the same slot in one batch
  // must land on distinct positions, not both at stale-max + 1.
  const nextPosition = new Map<string, number>();
  const positionOf = (slotId: string) => {
    const position =
      nextPosition.get(slotId) ??
      athlete.ctx.exercises
        .filter((e) => e.slot_id === slotId)
        .reduce((max, e) => Math.max(max, e.position), 0) + 1;
    nextPosition.set(slotId, position + 1);
    return position;
  };

  // set_wave edits whichever wave is LIVE for this phase — the same
  // scope the editor displays via phaseEngineConfig. Two ops in one
  // batch accumulate on this copy and both land.
  const phaseRow = athlete.ctx.phases.find((p) => p.id === phaseId) ?? null;
  const waveTarget =
    phaseRow?.progression_mode === "fixed_pct"
      ? ("fixed" as const)
      : (phaseRow?.wave ?? []).map(Number).some((n) => n > 0)
        ? ("phase" as const)
        : ("program" as const);
  const wave =
    waveTarget === "phase"
      ? (phaseRow!.wave ?? []).map(Number)
      : [...(snapshot.programWave ?? [])];
  let waveTouched = false;

  let appliedCount = 0;
  const failures: string[] = [];
  // Timeline events are written only after BOTH rollback gates pass —
  // a rolled-back batch used to leave "ai_change" entries for changes
  // that never persisted.
  const appliedOps: ChangeOp[] = [];

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
        if (waveTarget === "fixed") {
          error = {
            message: "esta fase va a porcentaje fijo: no hay ola que editar",
          };
        } else if (op.waveIndex! >= wave.length) {
          error = { message: "paso de la ola fuera de rango" };
        } else {
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
    appliedOps.push(op);
  }

  if (waveTouched && failures.length === 0) {
    const { error } =
      waveTarget === "phase"
        ? await supabase
            .from("program_phases")
            .update({ wave })
            .eq("id", phaseId)
        : await supabase
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

  // Sanity rules over the plan as it now stands — but a batch is only
  // blocked by violations IT introduced. A pre-existing one (a template
  // phase seeded without mobility, a hand-edited week) must not veto
  // every unrelated change forever.
  const slotsForRules = athlete.ctx.slots
    .filter((s) => s.phase_id === phaseId)
    .map((s) => ({ id: s.id, label: s.label, sessionType: s.session_type }));
  const preWarnings = planWarnings({
    slots: slotsForRules,
    exercises: snapshot.exercises.map((e) => ({
      slotId: e.slot_id,
      sets: e.sets,
      isPrimary: e.is_primary,
    })),
    days: snapshot.days.map((d) => ({
      dayIndex: d.day_index,
      slotId: d.slot_id,
    })),
  });

  const slotIds = slotsForRules.map((s) => s.id);
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

  const postWarnings = planWarnings({
    slots: slotsForRules,
    exercises: (freshExercises ?? []).map((e) => ({
      slotId: e.slot_id,
      sets: e.sets,
      isPrimary: e.is_primary,
    })),
    days: (freshDays ?? []).map((d) => ({
      dayIndex: d.day_index,
      slotId: d.slot_id,
    })),
  });

  const blocking = newBlockingTitles(preWarnings, postWarnings);
  if (blocking.length > 0) {
    await restoreSnapshot(supabase, athlete, snapshot);
    return {
      ok: false,
      error: `El lote dejaría el plan en un estado inválido y se ha deshecho entero: ${blocking.join(" · ")}.`,
    };
  }

  // Both gates passed: NOW the changes are real — log them.
  if (appliedOps.length > 0) {
    await supabase.from("engine_events").insert(
      appliedOps.map((op) => ({
        user_id: athlete.userId,
        program_id: athlete.ctx.program.id,
        week: athlete.placement.absoluteWeek,
        kind: "ai_change" as const,
        title: op.title,
        detail: `${op.from || "—"} → ${op.to || "—"}${op.why ? ` · ${op.why}` : ""}`,
        payload: { proposal_id: proposalId, op: op.op },
      })),
    );
  }

  await supabase
    .from("ai_proposals")
    .update({
      status: "applied",
      // The indices that actually landed, not the raw client array —
      // the editor shows this count as "applied".
      accepted_indices: appliedOps
        .map((op) => indexByOp.get(op))
        .filter((i): i is number => i !== undefined),
      snapshot: snapshot as unknown as Json,
      applied_at: new Date().toISOString(),
    })
    .eq("id", proposalId);

  if (proposal.thread_id) {
    const appliedTitles = appliedOps.map((o) => o.title).join(" · ");
    const rejectedTitles = applyDropped
      .map((d) => `${d.op.title} (${d.reason})`)
      .join(" · ");
    await supabase.from("ai_messages").insert({
      thread_id: proposal.thread_id,
      user_id: athlete.userId,
      role: "assistant",
      content:
        `Aplicado: ${appliedTitles || "nada"}.` +
        (rejectedTitles ? ` Rechazado por las reglas: ${rejectedTitles}.` : "") +
        " El motor de pesos sigue igual: las RM y la regla de regresión no se han tocado.",
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

export interface GeneratedPreview {
  programId: string;
  name: string;
  startsOn: string;
  phases: Array<{
    key: string;
    name: string;
    weeks: number;
    warnings: Array<{ tone: "warn" | "fail"; title: string; detail: string }>;
  }>;
  /** Engine lifts the plan needs that the athlete does not track yet. */
  newLiftKeys: string[];
}

/**
 * Build the programme INACTIVE and hand back a preview. Nothing takes
 * charge until `activateProgram` — the athlete reviews the phases,
 * seeds any missing RMs (never a fabricated number), and activates
 * explicitly. Non-negotiable 3 applies to the biggest change too.
 */
export async function rebuildProgram(input: {
  brief: string;
  startsOn?: string;
}): Promise<{
  ok: boolean;
  error?: string;
  needsApiKey?: boolean;
  preview?: GeneratedPreview;
}> {
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
  // Snap to Monday: day_index 0 is hard-wired to it across the app.
  const startsOn = startOfWeek(input.startsOn || todayIso());
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

  // The plan rules, per phase, over the parsed structure — the same
  // rules that gate the editor. Blocking ones show in the preview and
  // veto activation; the generator never ships a state the refine loop
  // would then choke on.
  const phasePreviews = program.phases.map((phase) => ({
    key: phase.key,
    name: phase.name,
    weeks: phase.weeks,
    warnings: planWarnings({
      slots: phase.slots.map((s) => ({
        id: s.key,
        label: s.label,
        sessionType: s.sessionType,
      })),
      exercises: phase.slots.flatMap((s) =>
        s.exercises.map((e) => ({
          slotId: s.key,
          sets: e.sets,
          isPrimary: e.isPrimary,
        })),
      ),
      days: phase.days.map((d) => ({
        dayIndex: d.dayIndex,
        slotId: d.slotKey,
      })),
    }).map((w) => ({ tone: w.tone, title: w.title, detail: w.detail })),
  }));

  // Lifts the plan needs but the athlete does not track. Their RMs are
  // the athlete's to seed in the preview — never a fabricated 60 kg
  // presented with the engine's authority.
  const liftKeys = new Set<string>(
    program.phases.flatMap((p) =>
      p.slots.flatMap((s) =>
        s.exercises.flatMap((e) => (e.liftKey ? [e.liftKey] : [])),
      ),
    ),
  );
  const existing = new Set(athlete.ctx.lifts.map((l) => l.key));
  const newLiftKeys = [...liftKeys].filter((k) => !existing.has(k));

  revalidatePath("/", "layout");
  return {
    ok: true,
    preview: {
      programId: created.id,
      name: program.name,
      startsOn,
      phases: phasePreviews,
      newLiftKeys,
    },
  };
}

/** Throw away a generated programme the athlete decided not to keep. */
export async function discardGeneratedProgram(
  programId: string,
): Promise<{ ok: boolean; error?: string }> {
  const athlete = await loadAthlete();
  if (!athlete) return { ok: false, error: "Sin sesión iniciada." };
  const supabase = await createClient();
  const { error } = await supabase
    .from("programs")
    .delete()
    .eq("id", programId)
    .eq("user_id", athlete.userId)
    .eq("is_active", false);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
