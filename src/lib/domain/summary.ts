/**
 * Session summary maths, shared by the server resumen page and the
 * offline shell. Everything here comes off logged sets; nothing is
 * estimated.
 */

import { formatWeight } from "@/lib/engine";
import { weightLabelFor, type LoadMode } from "./plan";

/** The slice of a set log the summary needs — server row or local entry. */
export interface SummarySetRow {
  reps: number | null;
  seconds: number | null;
  weight_kg: number | string | null;
  missed_range: boolean;
}

export interface ExerciseSummary {
  key: string;
  name: string;
  isPrimary: boolean;
  /** Sets the plan asked for, deload included. Null when off-plan. */
  plannedSets: number | null;
  doneSets: number;
  missedSets: number;
  /** "5 · 5 · 4" — what was actually logged. */
  repsLabel: string;
  weightLabel: string;
}

export function summarise(
  key: string,
  name: string,
  isPrimary: boolean,
  plannedSets: number | null,
  loadMode: LoadMode | null,
  rows: SummarySetRow[],
): ExerciseSummary {
  const kgs = rows
    .filter((r) => r.weight_kg != null)
    .map((r) => Number(r.weight_kg));
  const loggedKg = kgs.length ? kgs[0] : null;
  // The athlete can change the load mid-exercise: say so instead of
  // reporting the first set's weight as if it held for all of them.
  const spread =
    kgs.length > 1 && Math.min(...kgs) !== Math.max(...kgs)
      ? `${formatWeight(Math.min(...kgs))}–${formatWeight(Math.max(...kgs))} kg`
      : null;
  return {
    key,
    name,
    isPrimary,
    plannedSets,
    doneSets: rows.length,
    missedSets: rows.filter((r) => r.missed_range).length,
    repsLabel: rows
      .map((r) => {
        const value = r.reps ?? r.seconds;
        if (value == null) return "—";
        return r.reps == null ? `${value}″` : String(value);
      })
      .join(" · "),
    weightLabel:
      spread ??
      (loadMode
        ? weightLabelFor(loadMode, loggedKg)
        : loggedKg == null
          ? "—"
          : `${formatWeight(loggedKg)} kg`),
  };
}

/** "52′", "1 h 05′". Never a bare number of seconds. */
export function formatMinutes(seconds: number | null): string | null {
  if (!seconds || seconds <= 0) return null;
  const total = Math.round(seconds / 60);
  if (total < 60) return `${total}′`;
  return `${Math.floor(total / 60)} h ${String(total % 60).padStart(2, "0")}′`;
}
