import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { IsoDate } from "@/lib/domain/calendar";
import type { ProgramExerciseRow } from "@/lib/domain/plan";
import type { Database } from "@/lib/supabase/database.types";

/** One earlier session of an exercise, as it was actually lifted. */
export interface PastSession {
  date: IsoDate;
  sets: Array<{
    weightKg: number | null;
    /** Reps, or seconds on timed work. */
    value: number | null;
    rir: number | null;
  }>;
}

/** Program exercise id → its earlier sessions, newest first. */
export type ExerciseHistory = Record<string, PastSession[]>;

const SESSIONS_KEPT = 6;

/**
 * What the athlete did the last times each of these exercises came up.
 *
 * Matched by the name the set was logged under — the one thing that says
 * what was really lifted: a plan row keeps its id when the coach swaps the
 * exercise on it, and every phase has rows of its own. Rows that share the
 * catalogue entry ("Remo con barra o polea" / "Remo con barra") count as
 * the same movement.
 */
export async function loadExerciseHistory(
  supabase: SupabaseClient<Database>,
  userId: string,
  planRows: ProgramExerciseRow[],
  exerciseIds: string[],
  excludeSessionId?: string,
): Promise<ExerciseHistory> {
  const namesFor = new Map<string, Set<string>>();
  for (const id of exerciseIds) {
    const row = planRows.find((e) => e.id === id);
    if (!row) continue;
    const names = new Set([row.name]);
    if (row.exercise_id) {
      for (const e of planRows) {
        if (e.exercise_id === row.exercise_id) names.add(e.name);
      }
    }
    namesFor.set(id, names);
  }
  const allNames = [...new Set([...namesFor.values()].flatMap((s) => [...s]))];
  if (allNames.length === 0) return {};

  let query = supabase
    .from("set_logs")
    .select("session_id, exercise_name, set_index, weight_kg, reps, seconds, rir")
    .eq("user_id", userId)
    .in("exercise_name", allNames)
    .order("logged_at", { ascending: false })
    .limit(800);
  if (excludeSessionId) query = query.neq("session_id", excludeSessionId);
  const { data: logs } = await query;
  if (!logs?.length) return {};

  const { data: sessions } = await supabase
    .from("sessions")
    .select("id, scheduled_on, started_at")
    .eq("user_id", userId)
    .in("status", ["done", "partial"])
    .in("id", [...new Set(logs.map((l) => l.session_id))]);
  // The day it was really trained: a session can fulfil its plan day
  // early or late within the week.
  const dateOf = new Map(
    (sessions ?? []).map((s) => [
      s.id,
      (s.started_at?.slice(0, 10) ?? s.scheduled_on) as IsoDate,
    ]),
  );

  const history: ExerciseHistory = {};
  for (const [id, names] of namesFor) {
    const bySession = new Map<string, typeof logs>();
    for (const l of logs) {
      if (!names.has(l.exercise_name) || !dateOf.has(l.session_id)) continue;
      const rows = bySession.get(l.session_id);
      if (rows) rows.push(l);
      else bySession.set(l.session_id, [l]);
    }
    const past = [...bySession.entries()]
      .map(([sessionId, rows]) => ({
        date: dateOf.get(sessionId)!,
        sets: rows
          .sort((a, b) => a.set_index - b.set_index)
          .map((l) => ({
            weightKg: l.weight_kg == null ? null : Number(l.weight_kg),
            value: l.reps ?? l.seconds,
            rir: l.rir == null ? null : Number(l.rir),
          })),
      }))
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
      .slice(0, SESSIONS_KEPT);
    if (past.length > 0) history[id] = past;
  }
  return history;
}
