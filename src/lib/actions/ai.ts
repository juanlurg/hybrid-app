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
  buildPlanContext,
} from "@/lib/ai/prompt";
import {
  PROGRAM_JSON_SCHEMA,
  PROPOSAL_JSON_SCHEMA,
  changeOpSchema,
  generatedProgramSchema,
  proposalSchema,
  type ChangeOp,
} from "@/lib/ai/schema";
import type { Database } from "@/lib/supabase/database.types";
import type { ProgramExerciseRow } from "@/lib/domain/plan";
import { addDays, startOfWeek, todayIso } from "@/lib/domain/calendar";

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

  const planContext = buildPlanContext(athlete, phase);

  const contents: Array<{ role: "user" | "model"; text: string }> = [
    { role: "user", text: `Este es mi plan ahora mismo:\n\n${planContext}` },
    {
      role: "model",
      text: "Entendido. Tengo el plan y el estado del motor. Dime qué quieres cambiar.",
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
    const { data, usage } = await generateJson({
      systemInstruction: COACH_SYSTEM_INSTRUCTION,
      contents,
      jsonSchema: PROPOSAL_JSON_SCHEMA,
    });
    const result = proposalSchema.safeParse(data);
    if (!result.success) {
      return {
        ok: false,
        error:
          "La propuesta de la IA no encaja con el formato esperado. Prueba a reformular la pregunta.",
      };
    }
    parsed = { ...result.data, usage };
  } catch (cause) {
    return {
      ok: false,
      error: cause instanceof Error ? cause.message : "Error inesperado.",
      needsApiKey: cause instanceof MissingApiKeyError,
    };
  }

  // Drop anything that points at a slot or exercise this athlete does not own.
  const validExercises = new Set(
    athlete.ctx.exercises
      .filter((e) =>
        athlete.ctx.slots.some(
          (s) => s.id === e.slot_id && s.phase_id === phase.id,
        ),
      )
      .map((e) => e.id),
  );
  const validSlots = new Set(
    athlete.ctx.slots.filter((s) => s.phase_id === phase.id).map((s) => s.id),
  );

  const changes = parsed.changes.filter((c) => {
    if (c.exerciseId && !validExercises.has(c.exerciseId)) return false;
    if (c.slotId && !validSlots.has(c.slotId)) return false;
    if (c.targetSlotId && !validSlots.has(c.targetSlotId)) return false;
    // Never let a proposal orphan the regression trigger.
    if (c.op === "remove_exercise" && c.exerciseId) {
      const row = athlete.ctx.exercises.find((e) => e.id === c.exerciseId);
      if (row?.is_primary) return false;
    }
    return true;
  });

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
  const accepted = acceptedIndices
    .filter((i) => i >= 0 && i < allChanges.length)
    .map((i) => changeOpSchema.safeParse(allChanges[i]))
    .filter((r) => r.success)
    .map((r) => r.data);

  if (accepted.length === 0)
    return { ok: false, error: "No has seleccionado ningún cambio." };

  const phaseId = proposal.phase_id ?? athlete.placement.phase.id;
  const snapshot = snapshotOf(athlete, phaseId);

  const positionOf = (slotId: string) => {
    const rows = athlete.ctx.exercises.filter((e) => e.slot_id === slotId);
    return rows.reduce((max, e) => Math.max(max, e.position), 0) + 1;
  };

  let appliedCount = 0;
  for (const op of accepted) {
    switch (op.op) {
      case "remove_exercise":
        await supabase
          .from("program_exercises")
          .delete()
          .eq("id", op.exerciseId!)
          .eq("is_primary", false);
        break;

      case "add_exercise":
        await supabase.from("program_exercises").insert({
          slot_id: op.slotId!,
          position: positionOf(op.slotId!),
          name: op.name!,
          sets: op.sets ?? 3,
          rep_min: op.repMin ?? 8,
          rep_max: op.repMax ?? 10,
          rest_seconds: op.restSeconds ?? 90,
          load_mode: "fixed",
          notes: op.why ?? "",
        });
        break;

      case "move_exercise":
        await supabase
          .from("program_exercises")
          .update({
            slot_id: op.targetSlotId!,
            position: positionOf(op.targetSlotId!),
          })
          .eq("id", op.exerciseId!);
        break;

      case "rename_exercise":
        await supabase
          .from("program_exercises")
          .update({ name: op.name! })
          .eq("id", op.exerciseId!);
        break;

      case "set_sets":
        await supabase
          .from("program_exercises")
          .update({ sets: op.sets! })
          .eq("id", op.exerciseId!);
        break;

      case "set_reps":
        await supabase
          .from("program_exercises")
          .update({ rep_min: op.repMin!, rep_max: op.repMax! })
          .eq("id", op.exerciseId!);
        break;

      case "set_rest":
        await supabase
          .from("program_exercises")
          .update({ rest_seconds: op.restSeconds! })
          .eq("id", op.exerciseId!);
        break;

      case "set_day_slot":
        await supabase.from("program_days").upsert(
          {
            phase_id: phaseId,
            day_index: op.dayIndex!,
            slot_id: op.slotId!,
          },
          { onConflict: "phase_id,day_index" },
        );
        break;

      case "set_wave": {
        const wave = [...snapshot.wave];
        if (op.waveIndex! < wave.length) {
          wave[op.waveIndex!] = op.waveValue!;
          await supabase
            .from("programs")
            .update({ wave })
            .eq("id", athlete.ctx.program.id);
        }
        break;
      }

      case "note":
        // Advisory only — recorded in the timeline, changes nothing.
        break;
    }

    appliedCount += 1;
    await supabase.from("engine_events").insert({
      user_id: athlete.userId,
      program_id: athlete.ctx.program.id,
      week: athlete.placement.absoluteWeek,
      kind: "ai_change",
      title: op.title,
      detail: `${op.from || "—"} → ${op.to || "—"}${op.why ? ` · ${op.why}` : ""}`,
      payload: { proposal_id: proposalId, op: op.op },
    });
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

  const slotIds = athlete.ctx.slots
    .filter((s) => s.phase_id === snapshot.phaseId)
    .map((s) => s.id);

  // Exact restore: wipe the phase's exercises and put the snapshot back,
  // ids and all, so anything referencing them still resolves.
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

  let program;
  try {
    const { data } = await generateJson({
      systemInstruction: BUILDER_SYSTEM_INSTRUCTION,
      contents: [
        {
          role: "user",
          text:
            `${brief}\n\n` +
            `El plan arranca el lunes ${startsOn}. ` +
            `Material disponible: barra de ${athlete.config.barKg} kg, discos ${athlete.config.platesKg.join("/")} kg, mancuernas, poleas, kettlebells y barra de dominadas.` +
            (athlete.ctx.profile.lthr
              ? ` LTHR conocido: ${athlete.ctx.profile.lthr} ppm.`
              : " El LTHR aún no está medido: mete un test de umbral en una semana de descarga."),
        },
      ],
      jsonSchema: PROGRAM_JSON_SCHEMA,
      temperature: 0.5,
      maxOutputTokens: 32768,
    });
    const parsed = generatedProgramSchema.safeParse(data);
    if (!parsed.success) {
      return {
        ok: false,
        error:
          "El plan generado no cumple el formato (falta un básico por sesión, o los 7 días de alguna fase). Prueba a pedirlo otra vez con menos fases.",
      };
    }
    program = parsed.data;
  } catch (cause) {
    return {
      ok: false,
      error: cause instanceof Error ? cause.message : "Error inesperado.",
      needsApiKey: cause instanceof MissingApiKeyError,
    };
  }

  // Every strength slot needs exactly one basic, or the engine has no anchor.
  for (const phase of program.phases) {
    for (const slot of phase.slots) {
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

  await supabase
    .from("programs")
    .update({ is_active: false })
    .eq("user_id", athlete.userId)
    .eq("is_active", true);

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
      is_active: true,
      source: "ai",
    })
    .select("id")
    .single();

  if (programError || !created) {
    // Put the previous program back in charge rather than leaving none active.
    await supabase
      .from("programs")
      .update({ is_active: true })
      .eq("id", athlete.ctx.program.id);
    return { ok: false, error: programError?.message ?? "No se ha podido crear el programa." };
  }

  let offsetWeeks = 0;
  for (const [index, phase] of program.phases.entries()) {
    const { data: phaseRow } = await supabase
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
    offsetWeeks += phase.weeks;
    if (!phaseRow) continue;

    const slotIdByKey = new Map<string, string>();
    for (const [sIndex, slot] of phase.slots.entries()) {
      const { data: slotRow } = await supabase
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
      if (!slotRow) continue;
      slotIdByKey.set(slot.key, slotRow.id);

      if (slot.exercises.length > 0) {
        await supabase.from("program_exercises").insert(
          slot.exercises.map((e, i) => ({
            slot_id: slotRow.id,
            position: i + 1,
            name: e.name,
            tag: e.isPrimary ? "BÁSICO" : "",
            sets: e.sets,
            rep_min: e.repMin,
            rep_max: e.repMax,
            rest_seconds: e.restSeconds,
            is_primary: e.isPrimary,
            load_mode: (e.liftKey ? "engine" : "fixed") as "engine" | "fixed",
            lift_key: e.liftKey ?? null,
            notes: e.notes,
          })),
        );
      }
    }

    const days = phase.days
      .filter((d) => slotIdByKey.has(d.slotKey))
      .map((d) => ({
        phase_id: phaseRow.id,
        day_index: d.dayIndex,
        slot_id: slotIdByKey.get(d.slotKey)!,
      }));
    if (days.length > 0) await supabase.from("program_days").insert(days);

    const runs = phase.runs
      .filter((r) => slotIdByKey.has(r.slotKey) && r.week <= phase.weeks)
      .map((r) => ({
        phase_id: phaseRow.id,
        slot_id: slotIdByKey.get(r.slotKey)!,
        week: r.week,
        prescription: r.prescription,
        target_minutes: r.targetMinutes ?? null,
        notes: r.notes,
      }));
    if (runs.length > 0) {
      await supabase
        .from("program_run_sessions")
        .upsert(runs, { onConflict: "phase_id,slot_id,week" });
    }
  }

  // Carry the athlete's tracked lifts over — the engine state is theirs,
  // not the plan's, and a new plan must not reset an RM.
  const liftKeys = new Set(
    program.phases.flatMap((p) =>
      p.slots.flatMap((s) =>
        s.exercises.map((e) => e.liftKey).filter((k): k is string => Boolean(k)),
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
