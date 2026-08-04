"use server";

import { revalidatePath } from "next/cache";

import { loadAthlete } from "@/lib/data/athlete";
import { todayIso } from "@/lib/domain/calendar";
import { createClient, getUser } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/database.types";

type ProfileUpdate = Database["public"]["Tables"]["profiles"]["Update"];
type Result = { ok: boolean; error?: string };

/** Only these columns can be written from the Ajustes screen. */
const WRITABLE = new Set<keyof ProfileUpdate>([
  "display_name",
  "body_weight_kg",
  "height_cm",
  "bar_kg",
  "plates_kg",
  "dumbbell_step_kg",
  "pulley_step_kg",
  "kettlebells_kg",
  "available_equipment",
  "rounding_kg",
  "regression_rule",
  "auto_deload",
  "sync_rm_after_retest",
  "inc_lower_kg",
  "inc_upper_kg",
  "target_rir",
  "auto_rest_timer",
  "rest_sound",
  "rest_vibration",
  "keep_screen_awake",
  "show_plate_breakdown",
  "lthr",
]);

export async function updateProfile(patch: ProfileUpdate): Promise<Result> {
  const user = await getUser();
  if (!user) return { ok: false, error: "Sin sesión iniciada." };

  const clean: ProfileUpdate = {};
  for (const [key, value] of Object.entries(patch)) {
    if (WRITABLE.has(key as keyof ProfileUpdate)) {
      (clean as Record<string, unknown>)[key] = value;
    }
  }
  if (Object.keys(clean).length === 0) return { ok: true };

  const supabase = await createClient();
  const { error } = await supabase
    .from("profiles")
    .update(clean)
    .eq("id", user.id);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/", "layout");
  return { ok: true };
}

export async function togglePlate(plateKg: number): Promise<Result> {
  const athlete = await loadAthlete();
  if (!athlete) return { ok: false, error: "Sin sesión iniciada." };

  const current = (athlete.ctx.profile.plates_kg ?? []).map(Number);
  const next = current.includes(plateKg)
    ? current.filter((p) => p !== plateKg)
    : [...current, plateKg].sort((a, b) => b - a);

  return updateProfile({ plates_kg: next });
}

/**
 * Stamp the backup as taken. Called from Ajustes AFTER the JSON has landed
 * on the device — the export route itself no longer stamps, so a download
 * that never resolves cannot silently reset the staleness warning.
 */
export async function markExported(): Promise<Result> {
  const user = await getUser();
  if (!user) return { ok: false, error: "Sin sesión iniciada." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("profiles")
    .update({ last_export_at: new Date().toISOString() })
    .eq("id", user.id);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/", "layout");
  return { ok: true };
}

/** Today's scale reading — one row per day, last write wins. */
export async function recordBodyMetric(input: {
  weightKg: number;
  waistCm?: number | null;
  notes?: string;
}): Promise<Result> {
  const user = await getUser();
  if (!user) return { ok: false, error: "Sin sesión iniciada." };

  const weightKg = Number(input.weightKg);
  if (!Number.isFinite(weightKg) || weightKg < 30 || weightKg > 300) {
    return { ok: false, error: "Peso fuera de rango (30-300 kg)." };
  }
  const waistCm = input.waistCm == null ? null : Number(input.waistCm);
  if (waistCm != null && (!Number.isFinite(waistCm) || waistCm < 40 || waistCm > 200)) {
    return { ok: false, error: "Cintura fuera de rango (40-200 cm)." };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("body_metrics").upsert(
    {
      user_id: user.id,
      on_date: todayIso(),
      weight_kg: weightKg,
      // Only overwrite what was actually sent: a weight-only entry must
      // not blank a waist measured earlier the same day.
      ...(waistCm != null ? { waist_cm: waistCm } : {}),
      ...(input.notes != null ? { notes: input.notes.trim() } : {}),
    },
    { onConflict: "user_id,on_date" },
  );
  if (error) return { ok: false, error: error.message };

  revalidatePath("/progreso");
  return { ok: true };
}

/** Wipe the training history for the active program. Irreversible. */
export async function clearHistory(): Promise<Result> {
  const athlete = await loadAthlete();
  if (!athlete) return { ok: false, error: "Sin sesión iniciada." };
  const supabase = await createClient();

  // set_logs / run_logs cascade from sessions.
  const { error } = await supabase
    .from("sessions")
    .delete()
    .eq("user_id", athlete.userId)
    .eq("program_id", athlete.ctx.program.id);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/", "layout");
  return { ok: true };
}
