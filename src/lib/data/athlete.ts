import "server-only";

import { cache } from "react";
import { redirect } from "next/navigation";

import { createClient, getUser } from "@/lib/supabase/server";
import type { EngineConfig } from "@/lib/engine";
import {
  engineConfigFrom,
  phaseSpans,
  type AthleteContext,
  type ProfileRow,
} from "@/lib/domain/plan";
import {
  placeAbsoluteWeek,
  placeDate,
  todayIso,
  totalWeeks,
  type IsoDate,
  type PhasePlacement,
} from "@/lib/domain/calendar";

export interface LoadedAthlete {
  userId: string;
  email: string | null;
  ctx: AthleteContext;
  config: EngineConfig;
  today: IsoDate;
  /** Where today falls in the season. */
  placement: PhasePlacement;
  seasonWeeks: number;
}

/**
 * Everything the app needs to render any screen, in one round trip's
 * worth of parallel queries. Cached per request so a page and its
 * children do not refetch.
 */
export const loadAthlete = cache(async (): Promise<LoadedAthlete | null> => {
  const user = await getUser();
  if (!user) return null;

  const supabase = await createClient();

  // One parallel round trip: the whole plan comes embedded through the
  // FKs (phases → slots → exercises, days, run sessions) instead of a
  // four-stage waterfall.
  const [profileRes, programRes, liftsRes] = await Promise.all([
    supabase.from("profiles").select("*").eq("id", user.id).maybeSingle(),
    supabase
      .from("programs")
      .select(
        "*, program_phases(*, program_slots(*, program_exercises(*)), program_days(*), program_run_sessions(*))",
      )
      .eq("user_id", user.id)
      .eq("is_active", true)
      .maybeSingle(),
    supabase.from("lifts").select("*").eq("user_id", user.id).order("key"),
  ]);

  const profile = profileRes.data as ProfileRow | null;
  if (!profile || !programRes.data) return null;
  const { program_phases: phaseRows, ...program } = programRes.data;

  const byPosition = (a: { position: number }, b: { position: number }) =>
    a.position - b.position;
  const phases = [...phaseRows].sort(byPosition);
  const slots = phases.flatMap((p) => p.program_slots).sort(byPosition);

  const ctx: AthleteContext = {
    profile,
    program,
    phases,
    slots,
    days: phases.flatMap((p) => p.program_days),
    exercises: slots.flatMap((s) => s.program_exercises).sort(byPosition),
    prescriptions: phases.flatMap((p) => p.program_run_sessions),
    lifts: (liftsRes.data ?? []) as AthleteContext["lifts"],
  };

  const today = todayIso();
  const placement = placeDate(phaseSpans(phases), today);
  if (!placement) return null;

  return {
    userId: user.id,
    email: user.email ?? null,
    ctx,
    config: engineConfigFrom(profile, program),
    today,
    placement,
    seasonWeeks: totalWeeks(phaseSpans(phases)),
  };
});

/** Guard for every app page: signed in and onboarded, or bounce. */
export async function requireAthlete(): Promise<LoadedAthlete> {
  const user = await getUser();
  if (!user) redirect("/entrar");
  const athlete = await loadAthlete();
  if (!athlete) redirect("/onboarding");
  return athlete;
}

/** Resolve an absolute program week to the phase it belongs to. */
export function weekContext(athlete: LoadedAthlete, absoluteWeek: number) {
  const spans = phaseSpans(athlete.ctx.phases);
  const placed = placeAbsoluteWeek(spans, absoluteWeek);
  if (!placed) return null;
  const phase = athlete.ctx.phases.find((p) => p.id === placed.phase.id);
  if (!phase) return null;
  return { phase, week: placed.week, absoluteWeek };
}
