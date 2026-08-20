import { notFound, redirect } from "next/navigation";

import { LocalSessionRunner } from "@/components/session/local-session-runner";
import { requireAthlete } from "@/lib/data/athlete";
import {
  liftStateFrom,
  phaseEngineConfig,
  resolveDay,
} from "@/lib/domain/plan";
import {
  parsePreviousLiftState,
  preSessionLiftState,
} from "@/lib/engine/replay";
import { setsForWeek, type LiftState } from "@/lib/engine";
import { createClient } from "@/lib/supabase/server";
import { placeDate } from "@/lib/domain/calendar";
import { phaseSpans } from "@/lib/domain/plan";
import { SessionRunner } from "@/components/session/session-runner";

export default async function SessionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const athlete = await requireAthlete();
  const supabase = await createClient();

  const [{ data: session }, { data: logs }] = await Promise.all([
    supabase
      .from("sessions")
      .select("*")
      .eq("id", id)
      .eq("user_id", athlete.userId)
      .maybeSingle(),
    supabase.from("set_logs").select("*").eq("session_id", id),
  ]);

  // Not in the database yet: a session started offline whose flush has
  // not landed. The device that opened it holds it in IndexedDB.
  if (!session) return <LocalSessionRunner sessionId={id} />;
  if (session.status === "done" || session.status === "partial") {
    redirect(`/sesion/${id}/resumen`);
  }

  const phase = athlete.ctx.phases.find((p) => p.id === session.phase_id);
  if (!phase) notFound();

  const placement = placeDate(phaseSpans(athlete.ctx.phases), session.scheduled_on);
  const absoluteWeek = placement?.absoluteWeek ?? session.week;

  const day = resolveDay(
    {
      ctx: athlete.ctx,
      config: athlete.config,
      phase,
      week: session.week,
      absoluteWeek,
    },
    session.day_index,
  );

  if (day.exercises.length === 0) redirect("/");

  /* ── what the client engine needs to run the fold locally ──── */
  const phaseConfig = phaseEngineConfig(athlete.config, phase);
  const primaryExercise = day.primary;
  const primaryRow = primaryExercise
    ? athlete.ctx.exercises.find((e) => e.id === primaryExercise.id)
    : null;
  const liftRow = primaryRow?.lift_key
    ? (athlete.ctx.lifts.find((l) => l.key === primaryRow.lift_key) ?? null)
    : null;

  // The fold must start from the lift as it was BEFORE this session:
  // events already flushed for it carry that state in their payload.
  let preLift: LiftState | null = null;
  const initialUndone: Array<{ position: number; setIndex: number }> = [];
  if (liftRow) {
    const { data: events } = await supabase
      .from("engine_events")
      .select("dedup_key, created_at, reverted_at, kind, payload")
      .eq("session_id", id)
      .eq("lift_id", liftRow.id);
    const failEvents = (events ?? []).filter(
      (e) =>
        (e.kind === "fail_hold" || e.kind === "fail_penalty") && e.dedup_key,
    );
    preLift = preSessionLiftState(
      liftStateFrom(liftRow),
      failEvents.map((e) => ({
        createdAt: e.created_at,
        previous: parsePreviousLiftState(
          (e.payload as { previous?: unknown } | null)?.previous,
        ),
      })),
    );
    for (const e of failEvents) {
      if (!e.reverted_at || !e.dedup_key) continue;
      const m = e.dedup_key.match(/:fail:(\d+):(\d+)$/);
      if (m) initialUndone.push({ position: +m[1], setIndex: +m[2] });
    }
  }

  return (
    <SessionRunner
      sessionId={id}
      sessionKey={{
        phaseId: phase.id,
        slotId: session.slot_id ?? day.slot?.id ?? "",
        scheduledOn: session.scheduled_on,
        week: session.week,
        dayIndex: session.day_index,
        sessionType: session.session_type,
        title: session.title,
      }}
      label={day.label}
      exercises={day.exercises}
      initialLogs={(logs ?? []).map((l) => ({
        programExerciseId: l.program_exercise_id,
        setIndex: l.set_index,
        reps: l.reps,
        seconds: l.seconds,
        weightKg: l.weight_kg == null ? null : Number(l.weight_kg),
        missedRange: l.missed_range,
      }))}
      initialUndone={initialUndone}
      replayCtx={{
        lift: preLift,
        primary:
          primaryRow && primaryRow.lift_key
            ? {
                programExerciseId: primaryRow.id,
                liftKey: primaryRow.lift_key,
                repMin: primaryRow.rep_min,
                sets: setsForWeek(primaryRow.sets, session.week, phaseConfig),
              }
            : null,
        week: session.week,
        config: phaseConfig,
      }}
      autoRest={athlete.ctx.profile.auto_rest_timer}
      sound={athlete.ctx.profile.rest_sound}
      vibration={athlete.ctx.profile.rest_vibration}
      keepAwake={athlete.ctx.profile.keep_screen_awake}
      showPlates={athlete.ctx.profile.show_plate_breakdown}
      targetRir={athlete.ctx.profile.target_rir}
    />
  );
}
