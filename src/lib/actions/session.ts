"use server";

import { revalidatePath } from "next/cache";

import {
  formatWeight,
  isRangeFailure,
  registerCleanSession,
  registerFailure,
  revertFailure,
  setsForWeek,
  tonnage,
  type LiftState,
} from "@/lib/engine";
import { doubleProgression } from "@/lib/engine/progression";
import {
  liftStateFrom,
  phaseEngineConfig,
  type SessionStatus,
} from "@/lib/domain/plan";
import { loadAthlete } from "@/lib/data/athlete";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/database.types";

type SessionType = Database["public"]["Enums"]["session_type"];

export interface EngineBanner {
  title: string;
  detail: string;
  tone: "warn" | "fail";
  liftKey: string;
  eventId: string;
}

export interface LogSetResult {
  ok: boolean;
  error?: string;
  banner?: EngineBanner;
}

function persistLift(lift: LiftState) {
  return {
    e1rm_kg: lift.e1rmKg,
    penalty: lift.penalty,
    fail_count: lift.failCount,
    hold: lift.hold,
    hold_at_kg: lift.holdAtKg,
  };
}

/* ── creating the session instance ───────────────────────────── */

export async function startSession(input: {
  phaseId: string;
  slotId: string;
  scheduledOn: string;
  week: number;
  dayIndex: number;
  sessionType: SessionType;
  title: string;
}): Promise<{ ok: boolean; sessionId?: string; error?: string }> {
  const athlete = await loadAthlete();
  if (!athlete) return { ok: false, error: "Sin sesión iniciada." };
  const supabase = await createClient();

  const { data: existing } = await supabase
    .from("sessions")
    .select("id, status")
    .eq("user_id", athlete.userId)
    .eq("scheduled_on", input.scheduledOn)
    .eq("slot_id", input.slotId)
    .maybeSingle();

  if (existing) {
    if (existing.status === "planned" || existing.status === "skipped") {
      await supabase
        .from("sessions")
        .update({ status: "in_progress", started_at: new Date().toISOString() })
        .eq("id", existing.id);
    }
    revalidatePath("/", "layout");
    return { ok: true, sessionId: existing.id };
  }

  const { data, error } = await supabase
    .from("sessions")
    .insert({
      user_id: athlete.userId,
      program_id: athlete.ctx.program.id,
      phase_id: input.phaseId,
      slot_id: input.slotId,
      scheduled_on: input.scheduledOn,
      week: input.week,
      day_index: input.dayIndex,
      session_type: input.sessionType,
      title: input.title,
      status: "in_progress",
      started_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (error) return { ok: false, error: error.message };
  revalidatePath("/", "layout");
  return { ok: true, sessionId: data.id };
}

/* ── logging a set ───────────────────────────────────────────── */

export async function logSet(input: {
  sessionId: string;
  programExerciseId: string;
  position: number;
  setIndex: number;
  reps: number;
  weightKg: number | null;
}): Promise<LogSetResult> {
  const athlete = await loadAthlete();
  if (!athlete) return { ok: false, error: "Sin sesión iniciada." };
  const supabase = await createClient();

  const exercise = athlete.ctx.exercises.find(
    (e) => e.id === input.programExerciseId,
  );
  if (!exercise) return { ok: false, error: "Ejercicio no encontrado." };

  const { data: session } = await supabase
    .from("sessions")
    .select("id, week, user_id, phase_id")
    .eq("id", input.sessionId)
    .maybeSingle();
  if (!session) return { ok: false, error: "Sesión no encontrada." };

  const missed = isRangeFailure(input.reps, exercise.rep_min);

  const { error: logError } = await supabase.from("set_logs").upsert(
    {
      session_id: input.sessionId,
      user_id: athlete.userId,
      program_exercise_id: exercise.id,
      lift_key: exercise.lift_key,
      exercise_name: exercise.name,
      position: input.position,
      set_index: input.setIndex,
      reps: input.reps,
      weight_kg: input.weightKg,
      missed_range: missed,
    },
    { onConflict: "session_id,position,set_index" },
  );
  if (logError) return { ok: false, error: logError.message };

  // Only the basic of the day can move the engine.
  if (!missed || !exercise.is_primary || !exercise.lift_key) {
    revalidatePath("/", "layout");
    return { ok: true };
  }

  const liftRow = athlete.ctx.lifts.find((l) => l.key === exercise.lift_key);
  if (!liftRow) {
    revalidatePath("/", "layout");
    return { ok: true };
  }

  // The engine speaks in phase-local weeks with the phase's own config.
  const sessionPhase = athlete.ctx.phases.find((p) => p.id === session.phase_id);
  const phaseConfig = sessionPhase
    ? phaseEngineConfig(athlete.config, sessionPhase)
    : athlete.config;

  const outcome = registerFailure(
    liftStateFrom(liftRow),
    input.weightKg ?? 0,
    session.week,
    phaseConfig,
  );

  await supabase
    .from("lifts")
    .update(persistLift(outcome.lift))
    .eq("id", liftRow.id);

  const { data: event } = await supabase
    .from("engine_events")
    .insert({
      user_id: athlete.userId,
      program_id: athlete.ctx.program.id,
      lift_id: liftRow.id,
      session_id: input.sessionId,
      week: session.week,
      kind: outcome.action === "hold" ? "fail_hold" : "fail_penalty",
      title: outcome.title,
      detail: outcome.detail,
      payload: {
        missed_at_kg: input.weightKg,
        reps: input.reps,
        rep_min: exercise.rep_min,
        forced_deload: outcome.forcedDeload,
        previous: persistLift(liftStateFrom(liftRow)),
      },
    })
    .select("id")
    .single();

  revalidatePath("/", "layout");

  return {
    ok: true,
    banner: {
      title: outcome.title,
      detail: outcome.detail,
      tone: outcome.action === "hold" ? "warn" : "fail",
      liftKey: exercise.lift_key,
      eventId: event?.id ?? "",
    },
  };
}

/** The banner's "deshacer": roll the engine back one step. */
export async function undoEngineEvent(
  eventId: string,
): Promise<{ ok: boolean; error?: string }> {
  const athlete = await loadAthlete();
  if (!athlete) return { ok: false, error: "Sin sesión iniciada." };
  const supabase = await createClient();

  const { data: event } = await supabase
    .from("engine_events")
    .select("*")
    .eq("id", eventId)
    .eq("user_id", athlete.userId)
    .maybeSingle();
  if (!event || !event.lift_id) return { ok: false, error: "Evento no encontrado." };
  if (event.reverted_at) return { ok: true };

  const liftRow = athlete.ctx.lifts.find((l) => l.id === event.lift_id);
  if (!liftRow) return { ok: false, error: "Ejercicio no encontrado." };

  const payload = event.payload as { previous?: Record<string, unknown> } | null;
  const previous = payload?.previous;

  // Prefer the exact pre-event snapshot; fall back to a generic revert.
  const restored = previous
    ? {
        e1rm_kg: Number(previous.e1rm_kg),
        penalty: Number(previous.penalty),
        fail_count: Number(previous.fail_count),
        hold: Boolean(previous.hold),
        hold_at_kg:
          previous.hold_at_kg == null ? null : Number(previous.hold_at_kg),
      }
    : persistLift(revertFailure(liftStateFrom(liftRow)));

  await supabase.from("lifts").update(restored).eq("id", liftRow.id);
  await supabase
    .from("engine_events")
    .update({ reverted_at: new Date().toISOString() })
    .eq("id", eventId);

  revalidatePath("/", "layout");
  return { ok: true };
}

/* ── finishing ───────────────────────────────────────────────── */

export async function finishSession(
  sessionId: string,
): Promise<{ ok: boolean; error?: string }> {
  const athlete = await loadAthlete();
  if (!athlete) return { ok: false, error: "Sin sesión iniciada." };
  const supabase = await createClient();

  const [{ data: session }, { data: logs }] = await Promise.all([
    supabase
      .from("sessions")
      .select("*")
      .eq("id", sessionId)
      .eq("user_id", athlete.userId)
      .maybeSingle(),
    supabase.from("set_logs").select("*").eq("session_id", sessionId),
  ]);
  if (!session) return { ok: false, error: "Sesión no encontrada." };

  const setLogs = logs ?? [];
  const slotExercises = athlete.ctx.exercises.filter(
    (e) => e.slot_id === session.slot_id,
  );
  const plannedSets = slotExercises.reduce((acc, e) => acc + e.sets, 0);
  const doneSets = setLogs.length;

  /* Re-finishing an already closed session must not re-earn progression. */
  const alreadyClosed =
    session.status === "done" || session.status === "partial";
  const sessionPhase = athlete.ctx.phases.find(
    (p) => p.id === session.phase_id,
  );
  const phaseConfig = sessionPhase
    ? phaseEngineConfig(athlete.config, sessionPhase)
    : athlete.config;

  const status: SessionStatus =
    plannedSets > 0 && doneSets < plannedSets ? "partial" : "done";

  const startedAt = session.started_at
    ? new Date(session.started_at).getTime()
    : null;
  const duration = startedAt
    ? Math.max(0, Math.round((Date.now() - startedAt) / 1000))
    : null;

  await supabase
    .from("sessions")
    .update({
      status,
      completed_at: new Date().toISOString(),
      duration_seconds: duration,
      tonnage_kg: tonnage(
        setLogs.map((l) => ({
          weightKg: l.weight_kg == null ? null : Number(l.weight_kg),
          reps: l.reps,
        })),
      ),
    })
    .eq("id", sessionId);

  // Double progression: an accessory that hit the top of the range on
  // every set earns its equipment's increment for the next session.
  // Only on the first close — re-finishing must not re-earn it.
  if (!alreadyClosed) {
    for (const e of slotExercises) {
      if (e.is_primary) continue;
      if (e.load_mode !== "fixed" && e.load_mode !== "weighted_bodyweight") {
        continue;
      }
      const rows = setLogs.filter((l) => l.program_exercise_id === e.id);
      const outcome = doubleProgression(
        {
          equipment: e.equipment,
          effort: e.effort as "reps" | "seconds" | "amrap",
          repMax: e.rep_max,
          plannedSets: setsForWeek(e.sets, session.week, phaseConfig),
          currentWeightKg:
            e.fixed_weight_kg == null ? null : Number(e.fixed_weight_kg),
          logs: rows.map((l) => ({
            reps: l.reps,
            seconds: l.seconds,
            rir: l.rir == null ? null : Number(l.rir),
          })),
        },
        phaseConfig,
      );
      if (!outcome.advance || outcome.nextWeightKg == null) continue;

      await supabase
        .from("program_exercises")
        .update({ fixed_weight_kg: outcome.nextWeightKg })
        .eq("id", e.id);
      await supabase.from("engine_events").insert({
        user_id: athlete.userId,
        program_id: athlete.ctx.program.id,
        session_id: sessionId,
        week: session.week,
        kind: "accessory_bump",
        title: `${e.name} · sube a ${formatWeight(outcome.nextWeightKg)} kg`,
        detail: `Todas las series al tope del rango. La próxima sesión: ${formatWeight(outcome.nextWeightKg)} kg.`,
        payload: {
          program_exercise_id: e.id,
          previous_kg: e.fixed_weight_kg,
          next_kg: outcome.nextWeightKg,
          reason: outcome.reason,
        },
      });
    }
  }

  // A clean run of the basic releases the hold and resets the counter.
  const primary = slotExercises.find((e) => e.is_primary && e.lift_key);
  if (primary) {
    const primaryLogs = setLogs.filter(
      (l) => l.program_exercise_id === primary.id,
    );
    const allClean =
      primaryLogs.length >= primary.sets &&
      primaryLogs.every((l) => !l.missed_range);
    const liftRow = athlete.ctx.lifts.find((l) => l.key === primary.lift_key);
    if (allClean && liftRow && (liftRow.hold || liftRow.fail_count > 0)) {
      const cleared = registerCleanSession(liftStateFrom(liftRow));
      await supabase
        .from("lifts")
        .update(persistLift(cleared))
        .eq("id", liftRow.id);
      await supabase.from("engine_events").insert({
        user_id: athlete.userId,
        program_id: athlete.ctx.program.id,
        lift_id: liftRow.id,
        session_id: sessionId,
        week: session.week,
        kind: "clean_reset",
        title: `${liftRow.name} · sesión limpia`,
        detail:
          "Todas las series dentro del rango. El contador de fallos vuelve a cero y el peso deja de estar en espera.",
      });
    }
  }

  revalidatePath("/", "layout");
  return { ok: true };
}

export async function setSessionStatus(input: {
  phaseId: string;
  slotId: string;
  scheduledOn: string;
  week: number;
  dayIndex: number;
  sessionType: SessionType;
  title: string;
  status: SessionStatus;
  notes?: string;
}): Promise<{ ok: boolean; error?: string }> {
  const athlete = await loadAthlete();
  if (!athlete) return { ok: false, error: "Sin sesión iniciada." };
  const supabase = await createClient();

  const { error } = await supabase.from("sessions").upsert(
    {
      user_id: athlete.userId,
      program_id: athlete.ctx.program.id,
      phase_id: input.phaseId,
      slot_id: input.slotId,
      scheduled_on: input.scheduledOn,
      week: input.week,
      day_index: input.dayIndex,
      session_type: input.sessionType,
      title: input.title,
      status: input.status,
      notes: input.notes ?? "",
      completed_at:
        input.status === "done" || input.status === "partial"
          ? new Date().toISOString()
          : null,
    },
    { onConflict: "user_id,scheduled_on,slot_id" },
  );

  if (error) return { ok: false, error: error.message };
  revalidatePath("/", "layout");
  return { ok: true };
}

/* ── running ─────────────────────────────────────────────────── */

export async function logRun(input: {
  phaseId: string;
  slotId: string;
  scheduledOn: string;
  week: number;
  dayIndex: number;
  sessionType: SessionType;
  title: string;
  prescription: string;
  durationMinutes?: number | null;
  distanceKm?: number | null;
  avgHr?: number | null;
  decouplingPct?: number | null;
  notes?: string;
}): Promise<{ ok: boolean; error?: string }> {
  const athlete = await loadAthlete();
  if (!athlete) return { ok: false, error: "Sin sesión iniciada." };
  const supabase = await createClient();

  const { data: session, error } = await supabase
    .from("sessions")
    .upsert(
      {
        user_id: athlete.userId,
        program_id: athlete.ctx.program.id,
        phase_id: input.phaseId,
        slot_id: input.slotId,
        scheduled_on: input.scheduledOn,
        week: input.week,
        day_index: input.dayIndex,
        session_type: input.sessionType,
        title: input.title,
        status: "done",
        completed_at: new Date().toISOString(),
        duration_seconds: input.durationMinutes
          ? Math.round(input.durationMinutes * 60)
          : null,
      },
      { onConflict: "user_id,scheduled_on,slot_id" },
    )
    .select("id")
    .single();

  if (error) return { ok: false, error: error.message };

  await supabase.from("run_logs").upsert(
    {
      session_id: session.id,
      user_id: athlete.userId,
      prescription: input.prescription,
      duration_seconds: input.durationMinutes
        ? Math.round(input.durationMinutes * 60)
        : null,
      distance_km: input.distanceKm ?? null,
      avg_hr: input.avgHr ?? null,
      decoupling_pct: input.decouplingPct ?? null,
      notes: input.notes ?? "",
    },
    { onConflict: "session_id" },
  );

  revalidatePath("/", "layout");
  return { ok: true };
}

/* ── mobility ────────────────────────────────────────────────── */

export async function logMobility(input: {
  performedOn: string;
  completedSlugs: string[];
  totalItems: number;
}): Promise<{ ok: boolean; error?: string }> {
  const athlete = await loadAthlete();
  if (!athlete) return { ok: false, error: "Sin sesión iniciada." };
  const supabase = await createClient();

  const { error } = await supabase.from("mobility_logs").upsert(
    {
      user_id: athlete.userId,
      performed_on: input.performedOn,
      completed_slugs: input.completedSlugs,
      total_items: input.totalItems,
    },
    { onConflict: "user_id,performed_on" },
  );

  if (error) return { ok: false, error: error.message };
  revalidatePath("/", "layout");
  return { ok: true };
}
