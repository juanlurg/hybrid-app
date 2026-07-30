"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { createClient, getUser } from "@/lib/supabase/server";
import { todayIso } from "@/lib/domain/calendar";

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
  const startsOn = String(formData.get("starts_on") ?? "") || todayIso();
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
    p_starts_on: startsOn,
    p_activate: true,
  });
  if (error) return { ok: false, error: error.message };

  revalidatePath("/", "layout");
  return { ok: true };
}
