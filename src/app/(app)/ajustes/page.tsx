import { SecondaryNav } from "@/components/app-shell";
import { ScreenHeader } from "@/components/ui/kit";
import { requireAthlete } from "@/lib/data/athlete";
import { formatWeight } from "@/lib/engine";

import { SettingsGroups, type SettingsProfile } from "./settings-groups";

export default async function AjustesPage() {
  const athlete = await requireAthlete();
  const { ctx, email } = athlete;
  const p = ctx.profile;

  const localPart = email ? email.split("@")[0] : "";
  const title = p.display_name.trim() || localPart || "Atleta";

  // The subtitle only states what the athlete has actually filled in.
  const bits: string[] = [];
  if (p.body_weight_kg != null)
    bits.push(`${formatWeight(Number(p.body_weight_kg))} kg`);
  if (p.height_cm != null) bits.push(`${p.height_cm} cm`);
  if (p.lthr != null) bits.push(`LTHR ${p.lthr} ppm`);

  const profile: SettingsProfile = {
    display_name: p.display_name,
    body_weight_kg: p.body_weight_kg == null ? null : Number(p.body_weight_kg),
    height_cm: p.height_cm,
    units: p.units,
    bar_kg: Number(p.bar_kg),
    plates_kg: (p.plates_kg ?? []).map(Number),
    dumbbell_step_kg: Number(p.dumbbell_step_kg),
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
    zone_model: p.zone_model,
    distance_unit: p.distance_unit,
    notify_session: p.notify_session,
    notify_deload: p.notify_deload,
    notify_weekly_summary: p.notify_weekly_summary,
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ScreenHeader
        eyebrow="AJUSTES"
        title={title}
        subtitle={
          bits.length ? (
            <span className="num">{bits.join(" · ")}</span>
          ) : undefined
        }
      />
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
        />
      </div>
    </div>
  );
}
