/**
 * Turns database rows into what the screens render.
 *
 * Pure functions over already-fetched data: the same resolution runs on
 * the server for the first paint and in the browser after an optimistic
 * log, and both get the same numbers.
 */

import {
  formatWeight,
  isDeloadWeek,
  plateBreakdown,
  setsForWeek,
  workingWeight,
  type EngineConfig,
  type LiftState,
  type PlateLoad,
  type WeightBreakdown,
} from "@/lib/engine";
import { prescriptionMinutes, runBlocks, type RunBlock } from "@/lib/engine/run";
import type { Database } from "@/lib/supabase/database.types";

import {
  DAY_LABELS,
  dateForPhaseDay,
  formatDayLong,
  type IsoDate,
  type PhaseSpan,
} from "./calendar";

type Tables = Database["public"]["Tables"];

export type ProfileRow = Tables["profiles"]["Row"];
export type ProgramRow = Tables["programs"]["Row"];
export type PhaseRow = Tables["program_phases"]["Row"];
export type SlotRow = Tables["program_slots"]["Row"];
export type DayRow = Tables["program_days"]["Row"];
export type ProgramExerciseRow = Tables["program_exercises"]["Row"];
export type RunPrescriptionRow = Tables["program_run_sessions"]["Row"];
export type LiftRow = Tables["lifts"]["Row"];
export type SessionRow = Tables["sessions"]["Row"];
export type SetLogRow = Tables["set_logs"]["Row"];
export type SessionType = Database["public"]["Enums"]["session_type"];
export type SessionStatus = Database["public"]["Enums"]["session_status"];
export type LoadMode = Database["public"]["Enums"]["load_mode"];

/** Coarse grouping that drives colour and iconography. */
export type SessionGroup = "strength" | "run" | "mobility" | "rest";

export function groupOf(type: SessionType): SessionGroup {
  if (type === "strength") return "strength";
  if (type === "mobility") return "mobility";
  if (type === "rest") return "rest";
  return "run";
}

/* ── context ─────────────────────────────────────────────────── */

export interface AthleteContext {
  profile: ProfileRow;
  program: ProgramRow;
  phases: PhaseRow[];
  slots: SlotRow[];
  days: DayRow[];
  exercises: ProgramExerciseRow[];
  prescriptions: RunPrescriptionRow[];
  lifts: LiftRow[];
}

export function phaseSpans(phases: PhaseRow[]): PhaseSpan[] {
  return phases.map((p) => ({
    id: p.id,
    key: p.key,
    name: p.name,
    position: p.position,
    weeks: p.weeks,
    // A phase always gets a start date at clone time; fall back defensively.
    startsOn: (p.starts_on ?? "1970-01-01") as IsoDate,
  }));
}

export function engineConfigFrom(
  profile: ProfileRow,
  program: ProgramRow,
): EngineConfig {
  const wave = (program.wave ?? []).map(Number).filter((n) => n > 0);
  const plates = (profile.plates_kg ?? []).map(Number).filter((n) => n > 0);
  return {
    wave: wave.length ? wave : [0.75, 0.8, 0.85, 0.7],
    cycleWeeks: program.cycle_weeks || 4,
    incLowerKg: Number(profile.inc_lower_kg ?? 5),
    incUpperKg: Number(profile.inc_upper_kg ?? 2.5),
    roundingKg: Number(profile.rounding_kg ?? 2.5),
    regressionRule: profile.regression_rule ?? "standard",
    barKg: Number(profile.bar_kg ?? 20),
    platesKg: plates.length ? plates : [25, 20, 15, 10, 5, 2.5, 1.25],
    autoDeload: profile.auto_deload ?? true,
  };
}

export function liftStateFrom(row: LiftRow): LiftState {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    e1rmKg: Number(row.e1rm_kg),
    penalty: Number(row.penalty ?? 0),
    failCount: row.fail_count ?? 0,
    hold: row.hold ?? false,
    holdAtKg: row.hold_at_kg == null ? null : Number(row.hold_at_kg),
  };
}

/* ── resolved shapes ─────────────────────────────────────────── */

export interface ResolvedExercise {
  id: string;
  position: number;
  name: string;
  tag: string;
  /** Sets after the deload adjustment. */
  sets: number;
  /** Sets as written in the plan, before the deload. */
  plannedSets: number;
  repMin: number;
  repMax: number;
  repsLabel: string;
  schemeLabel: string;
  restSeconds: number;
  restLabel: string;
  isPrimary: boolean;
  loadMode: LoadMode;
  liftKey: string | null;
  weightKg: number | null;
  weightLabel: string;
  plates: PlateLoad | null;
  breakdown: WeightBreakdown | null;
  notes: string;
}

export interface ResolvedDay {
  date: IsoDate;
  dayIndex: number;
  dayLabel: string;
  dateLabel: string;
  slot: SlotRow | null;
  sessionType: SessionType;
  group: SessionGroup;
  title: string;
  subtitle: string;
  label: string;
  exercises: ResolvedExercise[];
  primary: ResolvedExercise | null;
  prescription: string;
  runBlocks: RunBlock[];
  totalSets: number;
  estimatedMinutes: number;
  isDeload: boolean;
  week: number;
  phaseId: string;
}

/* ── resolution ──────────────────────────────────────────────── */

export function restLabel(seconds: number): string {
  if (seconds >= 60 && seconds % 60 === 0) return `${seconds / 60}′`;
  if (seconds > 60) return `${Math.floor(seconds / 60)}′${seconds % 60}″`;
  return `${seconds}″`;
}

export function repsLabel(min: number, max: number): string {
  return min === max ? String(min) : `${min}-${max}`;
}

/** "127,5 kg", "+12,5 kg", "corporal", "progresiv." */
export function weightLabelFor(
  loadMode: LoadMode,
  weightKg: number | null,
): string {
  if (loadMode === "rpe") return "progresiv.";
  if (loadMode === "bodyweight") return "corporal";
  if (weightKg == null) return "—";
  if (loadMode === "weighted_bodyweight") {
    return weightKg > 0 ? `+${formatWeight(weightKg)} kg` : "corporal";
  }
  return `${formatWeight(weightKg)} kg`;
}

/** Rough session length: ~3 min a set plus warm-up. Matches the plan's own maths. */
export function estimateMinutes(totalSets: number): number {
  return totalSets === 0 ? 0 : Math.round(totalSets * 3.1 + 12);
}

export function resolveExercise(
  row: ProgramExerciseRow,
  week: number,
  config: EngineConfig,
  liftsByKey: Map<string, LiftState>,
): ResolvedExercise {
  const plannedSets = row.sets;
  const sets = setsForWeek(plannedSets, week, config);

  let weightKg: number | null = null;
  let breakdown: WeightBreakdown | null = null;

  if (row.load_mode === "engine" && row.lift_key) {
    const lift = liftsByKey.get(row.lift_key);
    if (lift) {
      breakdown = workingWeight(lift, week, config);
      weightKg = breakdown.workingKg;
    }
  } else if (
    row.load_mode === "fixed" ||
    row.load_mode === "weighted_bodyweight"
  ) {
    weightKg = row.fixed_weight_kg == null ? null : Number(row.fixed_weight_kg);
  }

  const usesBar = row.load_mode === "engine";

  return {
    id: row.id,
    position: row.position,
    name: row.name,
    tag: row.tag ?? "",
    sets,
    plannedSets,
    repMin: row.rep_min,
    repMax: row.rep_max,
    repsLabel: repsLabel(row.rep_min, row.rep_max),
    schemeLabel: `${sets} × ${repsLabel(row.rep_min, row.rep_max)}`,
    restSeconds: row.rest_seconds,
    restLabel: restLabel(row.rest_seconds),
    isPrimary: row.is_primary,
    loadMode: row.load_mode,
    liftKey: row.lift_key,
    weightKg,
    weightLabel: weightLabelFor(row.load_mode, weightKg),
    plates: usesBar && weightKg != null ? plateBreakdown(weightKg, config) : null,
    breakdown,
    notes: row.notes ?? "",
  };
}

export interface ResolveOptions {
  ctx: AthleteContext;
  config: EngineConfig;
  phase: PhaseRow;
  /** 1-based week inside the phase. */
  week: number;
  /** Absolute week in the program — what the engine's wave runs on. */
  absoluteWeek: number;
}

export function resolveDay(
  opts: ResolveOptions,
  dayIndex: number,
): ResolvedDay {
  const { ctx, config, phase, week, absoluteWeek } = opts;
  const lthr = ctx.profile.lthr ?? 168;

  const dayRow = ctx.days.find(
    (d) => d.phase_id === phase.id && d.day_index === dayIndex,
  );
  const slot = dayRow
    ? (ctx.slots.find((s) => s.id === dayRow.slot_id) ?? null)
    : null;

  const date = dateForPhaseDay({ startsOn: phase.starts_on as IsoDate }, week, dayIndex);
  const sessionType: SessionType = slot?.session_type ?? "rest";
  const group = groupOf(sessionType);

  const liftsByKey = new Map(
    ctx.lifts.map((l) => [l.key, liftStateFrom(l)] as const),
  );

  const exercises =
    slot && group === "strength"
      ? ctx.exercises
          .filter((e) => e.slot_id === slot.id)
          .sort((a, b) => a.position - b.position)
          .map((e) => resolveExercise(e, absoluteWeek, config, liftsByKey))
      : [];

  const prescriptionRow = slot
    ? ctx.prescriptions.find(
        (r) =>
          r.phase_id === phase.id && r.slot_id === slot.id && r.week === week,
      )
    : undefined;
  const prescription = prescriptionRow?.prescription ?? "";

  const totalSets = exercises.reduce((acc, e) => acc + e.sets, 0);
  const minutes =
    group === "strength"
      ? estimateMinutes(totalSets)
      : group === "run"
        ? (prescriptionRow?.target_minutes ?? prescriptionMinutes(prescription))
        : group === "mobility"
          ? 20
          : 0;

  return {
    date,
    dayIndex,
    dayLabel: DAY_LABELS[dayIndex],
    dateLabel: formatDayLong(date),
    slot,
    sessionType,
    group,
    title: slot?.title ?? "Descanso",
    subtitle: slot?.subtitle ?? "",
    label: slot?.label ?? "DESCANSO",
    exercises,
    primary: exercises.find((e) => e.isPrimary) ?? null,
    prescription,
    runBlocks: group === "run" && prescription ? runBlocks(prescription, lthr) : [],
    totalSets,
    estimatedMinutes: minutes,
    isDeload: isDeloadWeek(absoluteWeek, config),
    week,
    phaseId: phase.id,
  };
}

export function resolveWeek(opts: ResolveOptions): ResolvedDay[] {
  return Array.from({ length: 7 }, (_, i) => resolveDay(opts, i));
}

/* ── session progress ────────────────────────────────────────── */

export interface SetSlot {
  exerciseId: string;
  setIndex: number;
  reps: number | null;
  weightKg: number | null;
  missedRange: boolean;
  logged: boolean;
}

/** Build the per-set grid the runner ticks through. */
export function buildSetGrid(
  exercises: ResolvedExercise[],
  logs: SetLogRow[],
): Map<string, SetSlot[]> {
  const byExercise = new Map<string, SetSlot[]>();
  for (const ex of exercises) {
    const rows = logs
      .filter((l) => l.program_exercise_id === ex.id)
      .sort((a, b) => a.set_index - b.set_index);
    const slots: SetSlot[] = Array.from({ length: ex.sets }, (_, i) => {
      const log = rows.find((r) => r.set_index === i);
      return {
        exerciseId: ex.id,
        setIndex: i,
        reps: log?.reps ?? null,
        weightKg: log?.weight_kg == null ? null : Number(log.weight_kg),
        missedRange: log?.missed_range ?? false,
        logged: Boolean(log),
      };
    });
    byExercise.set(ex.id, slots);
  }
  return byExercise;
}

export function completedSets(grid: Map<string, SetSlot[]>): number {
  let n = 0;
  for (const slots of grid.values()) n += slots.filter((s) => s.logged).length;
  return n;
}

export function isExerciseComplete(
  grid: Map<string, SetSlot[]>,
  exerciseId: string,
): boolean {
  const slots = grid.get(exerciseId);
  return Boolean(slots?.length) && slots!.every((s) => s.logged);
}
