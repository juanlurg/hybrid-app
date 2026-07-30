import { NextResponse } from "next/server";

import { createClient, getUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * Everything this athlete owns, as one JSON file. On the free tier this
 * download IS the backup — the history is the only irreplaceable thing
 * in the app, so the dump leans complete rather than tidy.
 */
export async function GET() {
  const user = await getUser();
  if (!user) {
    return NextResponse.json(
      { ok: false, error: "not_authenticated" },
      { status: 401 },
    );
  }

  const supabase = await createClient();

  const [
    profileRes,
    programsRes,
    liftsRes,
    sessionsRes,
    setLogsRes,
    runLogsRes,
    mobilityLogsRes,
    engineEventsRes,
    measurementsRes,
  ] = await Promise.all([
    supabase.from("profiles").select("*").eq("id", user.id).maybeSingle(),
    supabase.from("programs").select("*").eq("user_id", user.id),
    supabase.from("lifts").select("*").eq("user_id", user.id),
    supabase.from("sessions").select("*").eq("user_id", user.id),
    supabase.from("set_logs").select("*").eq("user_id", user.id),
    supabase.from("run_logs").select("*").eq("user_id", user.id),
    supabase.from("mobility_logs").select("*").eq("user_id", user.id),
    supabase.from("engine_events").select("*").eq("user_id", user.id),
    supabase.from("measurements").select("*").eq("user_id", user.id),
  ]);

  const programIds = (programsRes.data ?? []).map((p) => p.id);

  const { data: phases } = programIds.length
    ? await supabase
        .from("program_phases")
        .select("*")
        .in("program_id", programIds)
    : { data: [] };
  const phaseIds = (phases ?? []).map((p) => p.id);

  const [slotsRes, daysRes, runSessionsRes] = phaseIds.length
    ? await Promise.all([
        supabase.from("program_slots").select("*").in("phase_id", phaseIds),
        supabase.from("program_days").select("*").in("phase_id", phaseIds),
        supabase
          .from("program_run_sessions")
          .select("*")
          .in("phase_id", phaseIds),
      ])
    : [{ data: [] }, { data: [] }, { data: [] }];

  const slotIds = (slotsRes.data ?? []).map((s) => s.id);
  const { data: exercises } = slotIds.length
    ? await supabase
        .from("program_exercises")
        .select("*")
        .in("slot_id", slotIds)
    : { data: [] };

  const payload = {
    format: "bloques-export",
    version: 1,
    exportedAt: new Date().toISOString(),
    userId: user.id,
    email: user.email ?? null,
    profile: profileRes.data ?? null,
    programs: programsRes.data ?? [],
    programPhases: phases ?? [],
    programSlots: slotsRes.data ?? [],
    programDays: daysRes.data ?? [],
    programExercises: exercises ?? [],
    programRunSessions: runSessionsRes.data ?? [],
    lifts: liftsRes.data ?? [],
    sessions: sessionsRes.data ?? [],
    setLogs: setLogsRes.data ?? [],
    runLogs: runLogsRes.data ?? [],
    mobilityLogs: mobilityLogsRes.data ?? [],
    engineEvents: engineEventsRes.data ?? [],
    measurements: measurementsRes.data ?? [],
  };

  const stamp = new Date().toISOString().slice(0, 10);
  return new NextResponse(JSON.stringify(payload, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="bloques-export-${stamp}.json"`,
      "Cache-Control": "no-store",
    },
  });
}
