import { notFound, redirect } from "next/navigation";

import { requireAthlete } from "@/lib/data/athlete";
import { resolveDay } from "@/lib/domain/plan";
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

  if (!session) notFound();
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

  return (
    <SessionRunner
      sessionId={id}
      label={day.label}
      exercises={day.exercises}
      initialLogs={(logs ?? []).map((l) => ({
        programExerciseId: l.program_exercise_id,
        setIndex: l.set_index,
        reps: l.reps,
        seconds: l.seconds,
        missedRange: l.missed_range,
      }))}
      autoRest={athlete.ctx.profile.auto_rest_timer}
      sound={athlete.ctx.profile.rest_sound}
      vibration={athlete.ctx.profile.rest_vibration}
      keepAwake={athlete.ctx.profile.keep_screen_awake}
      showPlates={athlete.ctx.profile.show_plate_breakdown}
      targetRir={athlete.ctx.profile.target_rir}
    />
  );
}
