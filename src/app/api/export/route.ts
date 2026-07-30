import { NextResponse } from "next/server";

import { createClient, getUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * Everything this athlete owns, as one JSON file. On the free tier this
 * download IS the backup — the history is the only irreplaceable thing
 * in the app, so the dump leans complete rather than tidy.
 *
 * Two rules a backup cannot break: every table is PAGED past the
 * PostgREST max_rows cap (a season of set_logs blows past 1000 rows —
 * a silently truncated dump certified as complete is worse than none),
 * and any read error fails the whole download with a 500 instead of
 * shipping a hollow file and stamping it as a fresh copy.
 */

const PAGE = 1000;

async function fetchAll<T>(
  page: (
    from: number,
    to: number,
  ) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < PAGE) return out;
  }
}

export async function GET() {
  const user = await getUser();
  if (!user) {
    return NextResponse.json(
      { ok: false, error: "not_authenticated" },
      { status: 401 },
    );
  }

  const supabase = await createClient();

  try {
    const profileRes = await supabase
      .from("profiles")
      .select("*")
      .eq("id", user.id)
      .maybeSingle();
    if (profileRes.error) throw new Error(profileRes.error.message);

    const [
      programs,
      lifts,
      sessions,
      setLogs,
      runLogs,
      mobilityLogs,
      engineEvents,
      measurements,
      exercisesCatalog,
      mobilityItemsCatalog,
      aiThreads,
      aiMessages,
      aiProposals,
    ] = await Promise.all([
      fetchAll((a, b) =>
        supabase.from("programs").select("*").eq("user_id", user.id).order("id").range(a, b),
      ),
      fetchAll((a, b) =>
        supabase.from("lifts").select("*").eq("user_id", user.id).order("id").range(a, b),
      ),
      fetchAll((a, b) =>
        supabase.from("sessions").select("*").eq("user_id", user.id).order("id").range(a, b),
      ),
      fetchAll((a, b) =>
        supabase.from("set_logs").select("*").eq("user_id", user.id).order("id").range(a, b),
      ),
      fetchAll((a, b) =>
        supabase.from("run_logs").select("*").eq("user_id", user.id).order("id").range(a, b),
      ),
      fetchAll((a, b) =>
        supabase.from("mobility_logs").select("*").eq("user_id", user.id).order("id").range(a, b),
      ),
      fetchAll((a, b) =>
        supabase.from("engine_events").select("*").eq("user_id", user.id).order("id").range(a, b),
      ),
      fetchAll((a, b) =>
        supabase.from("measurements").select("*").eq("user_id", user.id).order("id").range(a, b),
      ),
      // The catalogues ride along because their UUIDs are per-environment:
      // without an id→slug map, every exercise_id in the dump would point
      // at rows a rebuilt database does not have.
      fetchAll((a, b) =>
        supabase.from("exercises").select("*").order("id").range(a, b),
      ),
      fetchAll((a, b) =>
        supabase.from("mobility_items").select("*").order("id").range(a, b),
      ),
      fetchAll((a, b) =>
        supabase.from("ai_threads").select("*").eq("user_id", user.id).order("id").range(a, b),
      ),
      fetchAll((a, b) =>
        supabase.from("ai_messages").select("*").eq("user_id", user.id).order("id").range(a, b),
      ),
      fetchAll((a, b) =>
        supabase.from("ai_proposals").select("*").eq("user_id", user.id).order("id").range(a, b),
      ),
    ]);

    const programIds = programs.map((p) => (p as { id: string }).id);
    const phases = programIds.length
      ? await fetchAll((a, b) =>
          supabase
            .from("program_phases")
            .select("*")
            .in("program_id", programIds)
            .order("id")
            .range(a, b),
        )
      : [];
    const phaseIds = phases.map((p) => (p as { id: string }).id);

    const [slots, days, runSessions] = phaseIds.length
      ? await Promise.all([
          fetchAll((a, b) =>
            supabase
              .from("program_slots")
              .select("*")
              .in("phase_id", phaseIds)
              .order("id")
              .range(a, b),
          ),
          fetchAll((a, b) =>
            supabase
              .from("program_days")
              .select("*")
              .in("phase_id", phaseIds)
              .order("phase_id")
              .order("day_index")
              .range(a, b),
          ),
          fetchAll((a, b) =>
            supabase
              .from("program_run_sessions")
              .select("*")
              .in("phase_id", phaseIds)
              .order("id")
              .range(a, b),
          ),
        ])
      : [[], [], []];

    const slotIds = slots.map((s) => (s as { id: string }).id);
    const exercises = slotIds.length
      ? await fetchAll((a, b) =>
          supabase
            .from("program_exercises")
            .select("*")
            .in("slot_id", slotIds)
            .order("id")
            .range(a, b),
        )
      : [];
    const liftDefaults = programIds.length
      ? await fetchAll((a, b) =>
          supabase
            .from("program_lift_defaults")
            .select("*")
            .in("program_id", programIds)
            .order("id")
            .range(a, b),
        )
      : [];

    const payload = {
      format: "bloques-export",
      version: 2,
      exportedAt: new Date().toISOString(),
      userId: user.id,
      email: user.email ?? null,
      profile: profileRes.data ?? null,
      programs,
      programPhases: phases,
      programSlots: slots,
      programDays: days,
      programExercises: exercises,
      programRunSessions: runSessions,
      programLiftDefaults: liftDefaults,
      lifts,
      sessions,
      setLogs,
      runLogs,
      mobilityLogs,
      engineEvents,
      measurements,
      exercisesCatalog,
      mobilityItemsCatalog,
      aiThreads,
      aiMessages,
      aiProposals,
    };

    // The staleness stamp behind "última copia hace N días" in Ajustes —
    // only after every read succeeded.
    await supabase
      .from("profiles")
      .update({ last_export_at: new Date().toISOString() })
      .eq("id", user.id);

    const stamp = new Date().toISOString().slice(0, 10);
    return new NextResponse(JSON.stringify(payload, null, 2), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="bloques-export-${stamp}.json"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    console.error("[export] failed", { message });
    return NextResponse.json(
      { ok: false, error: "export_failed" },
      { status: 500 },
    );
  }
}
