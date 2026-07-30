import { requireAthlete } from "@/lib/data/athlete";
import { createClient } from "@/lib/supabase/server";
import { formatDayShort } from "@/lib/domain/calendar";

import { MobilityBlock, type MobilityItem } from "./mobility-block";

export default async function MovilidadPage() {
  const athlete = await requireAthlete();
  const supabase = await createClient();

  const [{ data: rows }, { data: log }] = await Promise.all([
    supabase
      .from("mobility_items")
      .select(
        "id, owner_id, slug, group_name, name, dose, dose_unit, note, position",
      )
      .or(`owner_id.is.null,owner_id.eq.${athlete.userId}`)
      .order("position"),
    supabase
      .from("mobility_logs")
      .select("completed_slugs")
      .eq("user_id", athlete.userId)
      .eq("performed_on", athlete.today)
      .maybeSingle(),
  ]);

  // The catalogue is the global block plus the athlete's own rows, and the
  // schema lets both use the same slug. That is an override, not a second
  // exercise: keep the owned row so the block never shows a slug twice.
  const bySlug = new Map<string, NonNullable<typeof rows>[number]>();
  for (const row of rows ?? []) {
    const seen = bySlug.get(row.slug);
    if (!seen || (seen.owner_id === null && row.owner_id !== null)) {
      bySlug.set(row.slug, row);
    }
  }

  const items: MobilityItem[] = [...bySlug.values()]
    // Positions collide once a personal item joins the global list, so the
    // name breaks the tie and the order stays the same between renders.
    .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name, "es"))
    .map((r) => ({
      id: r.id,
      slug: r.slug,
      groupName: r.group_name,
      name: r.name,
      dose: r.dose,
      doseUnit: r.dose_unit,
      note: r.note,
    }));

  // A slug that is no longer in the block must not count towards today.
  const known = new Set(items.map((i) => i.slug));
  const completed = (log?.completed_slugs ?? []).filter((slug) =>
    known.has(slug),
  );

  return (
    <MobilityBlock
      items={items}
      initialCompleted={completed}
      performedOn={athlete.today}
      dateLabel={formatDayShort(athlete.today)}
    />
  );
}
