"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { createClient, getUser } from "@/lib/supabase/server";
import { startOfWeek, todayIso } from "@/lib/domain/calendar";
import { round2 } from "@/lib/engine";

export interface OnboardingState {
  error?: string;
}

/**
 * Clone the starter plan into a private program and fill in the few
 * numbers the engine cannot guess.
 */
export async function completeOnboarding(
  _prev: OnboardingState,
  formData: FormData,
): Promise<OnboardingState> {
  const user = await getUser();
  if (!user) redirect("/entrar");

  const displayName = String(formData.get("display_name") ?? "").trim();
  // day_index 0 is hard-wired to Monday everywhere: a mid-week start
  // would mislabel every weekday of the season. Snap, don't trust.
  const startsOn = startOfWeek(
    String(formData.get("starts_on") ?? "") || todayIso(),
  );
  const lthrRaw = String(formData.get("lthr") ?? "").trim();
  const weightRaw = String(formData.get("body_weight_kg") ?? "").trim();
  const template = String(formData.get("template") ?? "plan-maestro-hibrido");

  const lthr = lthrRaw ? Number(lthrRaw) : null;
  const bodyWeight = weightRaw ? Number(weightRaw.replace(",", ".")) : null;

  if (lthr != null && (Number.isNaN(lthr) || lthr < 100 || lthr > 230)) {
    return { error: "El LTHR tiene que estar entre 100 y 230 ppm." };
  }
  if (bodyWeight != null && Number.isNaN(bodyWeight)) {
    return { error: "El peso corporal no es un número." };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("onboard_athlete", {
    p_template_slug: template,
    p_starts_on: startsOn,
    ...(displayName ? { p_display_name: displayName } : {}),
    ...(lthr != null ? { p_lthr: lthr } : {}),
    ...(bodyWeight != null ? { p_body_weight_kg: bodyWeight } : {}),
  });

  if (error) return { error: error.message };

  revalidatePath("/", "layout");
  redirect("/");
}

/** Start over with a fresh copy of a template, keeping the old one archived. */
export async function switchProgram(
  templateSlug: string,
  startsOn: string,
): Promise<{ ok: boolean; error?: string }> {
  const user = await getUser();
  if (!user) return { ok: false, error: "Sin sesión iniciada." };

  const supabase = await createClient();
  const { data: template } = await supabase
    .from("programs")
    .select("id")
    .eq("is_template", true)
    .eq("slug", templateSlug)
    .maybeSingle();
  if (!template) return { ok: false, error: "Plantilla no encontrada." };

  const { error } = await supabase.rpc("clone_program", {
    p_source_id: template.id,
    p_starts_on: startOfWeek(startsOn),
    p_activate: true,
  });
  if (error) return { ok: false, error: error.message };

  revalidatePath("/", "layout");
  return { ok: true };
}

/**
 * Flip an archived (or freshly generated, still-inactive) programme to
 * active. Engine lifts the plan needs but the athlete does not track
 * yet must arrive as `seedRms` — their RMs belong to the athlete, never
 * to a default. This is what makes «puedes volver al anterior desde
 * Ajustes» true.
 */
export async function activateProgram(
  programId: string,
  seedRms?: Record<string, number>,
): Promise<{ ok: boolean; error?: string; missingLifts?: string[] }> {
  const user = await getUser();
  if (!user) return { ok: false, error: "Sin sesión iniciada." };
  const supabase = await createClient();

  const { data: program } = await supabase
    .from("programs")
    .select("id, name, is_active, starts_on")
    .eq("id", programId)
    .eq("user_id", user.id)
    .eq("is_template", false)
    .maybeSingle();
  if (!program) return { ok: false, error: "Programa no encontrado." };
  if (program.is_active) return { ok: true };

  // Which engine lifts does this programme prescribe?
  const { data: phases } = await supabase
    .from("program_phases")
    .select("id")
    .eq("program_id", programId);
  const phaseIds = (phases ?? []).map((p) => p.id);
  const { data: slots } = phaseIds.length
    ? await supabase.from("program_slots").select("id").in("phase_id", phaseIds)
    : { data: [] as Array<{ id: string }> };
  const slotIds = (slots ?? []).map((s) => s.id);
  const { data: exercises } = slotIds.length
    ? await supabase
        .from("program_exercises")
        .select("lift_key")
        .in("slot_id", slotIds)
        .not("lift_key", "is", null)
    : { data: [] as Array<{ lift_key: string | null }> };
  const needed = new Set(
    (exercises ?? []).flatMap((e) => (e.lift_key ? [e.lift_key] : [])),
  );

  const { data: lifts } = await supabase
    .from("lifts")
    .select("key")
    .eq("user_id", user.id);
  const tracked = new Set((lifts ?? []).map((l) => l.key));
  const missing = [...needed].filter((k) => !tracked.has(k));
  const unseeded = missing.filter(
    (k) => !(seedRms && Number.isFinite(seedRms[k]) && seedRms[k] > 0),
  );
  if (unseeded.length > 0) {
    return {
      ok: false,
      missingLifts: unseeded,
      error: `Faltan las RM de: ${unseeded.join(", ")}.`,
    };
  }
  if (missing.length > 0) {
    const { error } = await supabase.from("lifts").insert(
      missing.map((key) => ({
        user_id: user.id,
        key,
        name: key.charAt(0).toUpperCase() + key.slice(1),
        kind: (["sentadilla", "hipthrust", "rdl"].includes(key)
          ? "lower"
          : "upper") as "lower" | "upper",
        e1rm_kg: round2(seedRms![key]),
      })),
    );
    if (error) return { ok: false, error: error.message };
  }

  // The swap, with a re-activation guard: a failure after deactivation
  // must never leave the athlete with zero active programmes.
  const { data: prevActive } = await supabase
    .from("programs")
    .select("id")
    .eq("user_id", user.id)
    .eq("is_active", true)
    .maybeSingle();
  await supabase
    .from("programs")
    .update({ is_active: false })
    .eq("user_id", user.id)
    .eq("is_active", true);
  const { error: activateError } = await supabase
    .from("programs")
    .update({ is_active: true })
    .eq("id", programId);
  if (activateError) {
    if (prevActive) {
      await supabase
        .from("programs")
        .update({ is_active: true })
        .eq("id", prevActive.id);
    }
    return { ok: false, error: activateError.message };
  }

  await supabase.from("engine_events").insert({
    user_id: user.id,
    program_id: programId,
    week: 1,
    kind: "program_created",
    title: `Programa activado · ${program.name}`,
    detail: `Arranca el ${program.starts_on ?? "—"}. Las RM que ya seguías se conservan.`,
  });

  revalidatePath("/", "layout");
  return { ok: true };
}
