import { SecondaryNav } from "@/components/app-shell";
import { requireAthlete } from "@/lib/data/athlete";
import { createClient } from "@/lib/supabase/server";
import { daysBetween, todayIso } from "@/lib/domain/calendar";

import { SettingsGroups, type SettingsProfile } from "./settings-groups";

export default async function AjustesPage() {
  const athlete = await requireAthlete();
  const { ctx, email } = athlete;
  const p = ctx.profile;

  const supabase = await createClient();
  const { data: programRows } = await supabase
    .from("programs")
    .select("id, name, starts_on, is_active")
    .eq("user_id", athlete.userId)
    .eq("is_template", false)
    .order("created_at", { ascending: false });

  const exportAgeDays =
    p.last_export_at == null
      ? null
      : Math.max(0, daysBetween(p.last_export_at.slice(0, 10), todayIso()));

  const profile: SettingsProfile = {
    display_name: p.display_name,
    body_weight_kg: p.body_weight_kg == null ? null : Number(p.body_weight_kg),
    height_cm: p.height_cm,
    bar_kg: Number(p.bar_kg),
    plates_kg: (p.plates_kg ?? []).map(Number),
    dumbbell_step_kg: Number(p.dumbbell_step_kg),
    pulley_step_kg: Number(p.pulley_step_kg),
    kettlebells_kg: (p.kettlebells_kg ?? []).map(Number),
    available_equipment: p.available_equipment,
    rounding_kg: Number(p.rounding_kg),
    regression_rule: p.regression_rule,
    auto_deload: p.auto_deload,
    sync_rm_after_retest: p.sync_rm_after_retest,
    inc_lower_kg: Number(p.inc_lower_kg),
    inc_upper_kg: Number(p.inc_upper_kg),
    target_rir: p.target_rir,
    auto_rest_timer: p.auto_rest_timer,
    rest_sound: p.rest_sound,
    rest_vibration: p.rest_vibration,
    keep_screen_awake: p.keep_screen_awake,
    show_plate_breakdown: p.show_plate_breakdown,
    lthr: p.lthr,
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex-none px-5 pt-6">
        <div className="flex items-baseline gap-2.5">
          <h1 className="font-display flex-1 text-[22px] leading-none font-bold">
            Ajustes
          </h1>
          {/* The status is the one knob nothing else on the app surfaces. */}
          <span className="font-display flex-none text-[11px] leading-none text-faint uppercase">
            {p.lthr == null ? "LTHR sin test" : `LTHR ${p.lthr} ppm`}
          </span>
        </div>
      </header>
      <SecondaryNav />
      <div className="flex-1 overflow-auto">
        <SettingsGroups
          profile={profile}
          lifts={ctx.lifts.map((l) => ({
            id: l.id,
            name: l.name,
            kind: l.kind,
          }))}
          email={email}
          exportAgeDays={exportAgeDays}
          programs={(programRows ?? []).map((row) => ({
            id: row.id,
            name: row.name,
            starts_on: row.starts_on,
            is_active: row.is_active,
          }))}
        />
      </div>
    </div>
  );
}
