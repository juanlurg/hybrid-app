"use server";

import { revalidatePath } from "next/cache";

import { loadAthlete } from "@/lib/data/athlete";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/database.types";
import type { SessionStatus } from "@/lib/domain/plan";

type SessionType = Database["public"]["Enums"]["session_type"];

/**
 * What is left of this file after the local-first runner: the session
 * lifecycle (start / per-set logging / finish / undo) now flows through
 * the write-ahead queue into /api/sync — a Route Handler, immune to the
 * action-id rotation that breaks queued server actions on deploy.
 *
 * Only the low-frequency, online-assumed mutation below still lives
 * here.
 */

/** Mark a day skipped (or re-plan it) from the week list. */
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
