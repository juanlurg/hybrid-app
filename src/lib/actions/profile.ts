"use server";

import { revalidatePath } from "next/cache";

import { loadAthlete } from "@/lib/data/athlete";
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
