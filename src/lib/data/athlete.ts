import "server-only";

import { cache } from "react";
import { redirect } from "next/navigation";

import { createClient, getUser } from "@/lib/supabase/server";
import type { EngineConfig } from "@/lib/engine";
import {
  engineConfigFrom,
  phaseSpans,
  type AthleteContext,
  type PhaseRow,
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

  const [profileRes, programRes] = await Promise.all([
    supabase.from("profiles").select("*").eq("id", user.id).maybeSingle(),
    supabase
      .from("programs")
      .select("*")
      .eq("user_id", user.id)
      .eq("is_active", true)
      .maybeSingle(),
  ]);

  const profile = profileRes.data as ProfileRow | null;
  const program = programRes.data;
  if (!profile || !program) return null;

  const phasesRes = await supabase
    .from("program_phases")
    .select("*")
    .eq("program_id", program.id)
    .order("position");

  const phases = (phasesRes.data ?? []) as PhaseRow[];
  const phaseIds = phases.map((p) => p.id);

  const [slotsRes, daysRes, runsRes, liftsRes] = await Promise.all([
    supabase
      .from("program_slots")
      .select("*")
      .in("phase_id", phaseIds)
      .order("position"),
    supabase.from("program_days").select("*").in("phase_id", phaseIds),
    supabase.from("program_run_sessions").select("*").in("phase_id", phaseIds),
    supabase.from("lifts").select("*").eq("user_id", user.id).order("key"),
  ]);

  const slots = (slotsRes.data ?? []) as AthleteContext["slots"];
  const exercisesRes = await supabase
    .from("program_exercises")
    .select("*")
    .in(
      "slot_id",
      slots.map((s) => s.id),
    )
    .order("position");

  const ctx: AthleteContext = {
    profile,
    program,
    phases,
    slots,
    days: (daysRes.data ?? []) as AthleteContext["days"],
    exercises: (exercisesRes.data ?? []) as AthleteContext["exercises"],
    prescriptions: (runsRes.data ?? []) as AthleteContext["prescriptions"],
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
