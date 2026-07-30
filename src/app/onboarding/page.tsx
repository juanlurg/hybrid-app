import { redirect } from "next/navigation";

import { loadAthlete } from "@/lib/data/athlete";
import { createClient, getUser } from "@/lib/supabase/server";
import { startOfWeek, todayIso } from "@/lib/domain/calendar";

import { OnboardingForm } from "./onboarding-form";

export const dynamic = "force-dynamic";

export default async function OnboardingPage() {
  const user = await getUser();
  if (!user) redirect("/entrar");

  const athlete = await loadAthlete();
  if (athlete) redirect("/");

  const supabase = await createClient();
  const [{ data: templates }, { data: profile }] = await Promise.all([
    supabase
      .from("programs")
      .select("id, slug, name, goal, summary, starts_on, ends_on")
      .eq("is_template", true)
      .order("name"),
    supabase
      .from("profiles")
      .select("display_name")
      .eq("id", user.id)
      .maybeSingle(),
  ]);

  return (
    <OnboardingForm
      templates={(templates ?? []).map((t) => ({
        slug: t.slug ?? "",
        name: t.name,
        goal: t.goal,
        summary: t.summary,
      }))}
      defaultName={profile?.display_name ?? ""}
      defaultStart={startOfWeek(todayIso())}
    />
  );
}
