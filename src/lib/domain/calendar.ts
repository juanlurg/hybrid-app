/**
 * Calendar maths for a season.
 *
 * All dates are handled as plain `YYYY-MM-DD` strings in local terms —
 * a training day is a day, not an instant, and timezone drift on a
 * `Date` is exactly the bug that makes Monday's session show up on
 * Sunday for half the users.
 */

export type IsoDate = string; // YYYY-MM-DD

export const DAY_LABELS = [
  "LUN",
  "MAR",
  "MIÉ",
  "JUE",
  "VIE",
  "SÁB",
  "DOM",
] as const;

export const DAY_INITIALS = ["L", "M", "X", "J", "V", "S", "D"] as const;

export const MONTHS = [
  "ene",
  "feb",
  "mar",
  "abr",
  "may",
  "jun",
  "jul",
  "ago",
  "sep",
  "oct",
  "nov",
  "dic",
] as const;

export function toIsoDate(date: Date): IsoDate {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Parse `YYYY-MM-DD` at local midnight. */
export function parseIsoDate(iso: IsoDate): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

export function addDays(iso: IsoDate, days: number): IsoDate {
  const d = parseIsoDate(iso);
  d.setDate(d.getDate() + days);
  return toIsoDate(d);
}

/** Whole days from `a` to `b`. Negative when `b` is earlier. */
export function daysBetween(a: IsoDate, b: IsoDate): number {
  const ms = parseIsoDate(b).getTime() - parseIsoDate(a).getTime();
  return Math.round(ms / 86_400_000);
}

/** 0 = Monday … 6 = Sunday. */
export function dayIndexOf(iso: IsoDate): number {
  return (parseIsoDate(iso).getDay() + 6) % 7;
}

/** The Monday of the week containing `iso`. */
export function startOfWeek(iso: IsoDate): IsoDate {
  return addDays(iso, -dayIndexOf(iso));
}

export function todayIso(): IsoDate {
  return toIsoDate(new Date());
}

/** "MIÉ 14 OCT" */
export function formatDayLong(iso: IsoDate): string {
  const d = parseIsoDate(iso);
  return `${DAY_LABELS[dayIndexOf(iso)]} ${d.getDate()} ${MONTHS[d.getMonth()].toUpperCase()}`;
}

/** "14 oct" */
export function formatDayShort(iso: IsoDate): string {
  const d = parseIsoDate(iso);
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

/** "jul 26 → abr 27" */
export function formatSeasonRange(from: IsoDate, to: IsoDate): string {
  const a = parseIsoDate(from);
  const b = parseIsoDate(to);
  const yy = (d: Date) => String(d.getFullYear()).slice(2);
  return `${MONTHS[a.getMonth()]} ${yy(a)} → ${MONTHS[b.getMonth()]} ${yy(b)}`;
}

/* ── phases ──────────────────────────────────────────────────── */

export interface PhaseSpan {
  id: string;
  key: string;
  name: string;
  position: number;
  weeks: number;
  startsOn: IsoDate;
}

export interface PhasePlacement {
  phase: PhaseSpan;
  /** 1-based week inside the phase. */
  week: number;
  /** 1-based week inside the whole program. */
  absoluteWeek: number;
  /** 0 = Monday. */
  dayIndex: number;
  date: IsoDate;
}

/** The date a given (phase, week, dayIndex) falls on. */
export function dateForPhaseDay(
  phase: Pick<PhaseSpan, "startsOn">,
  week: number,
  dayIndex: number,
): IsoDate {
  return addDays(phase.startsOn, (week - 1) * 7 + dayIndex);
}

/** Last day (inclusive) of a phase. */
export function phaseEnd(phase: PhaseSpan): IsoDate {
  return addDays(phase.startsOn, phase.weeks * 7 - 1);
}

/**
 * Where a date lands in the season.
 *
 * Before the season starts it clamps to the first phase's first week;
 * after it ends, to the last phase's last week. A plan that has run out
 * should still render something rather than throw.
 */
export function placeDate(
  phases: PhaseSpan[],
  iso: IsoDate,
): PhasePlacement | null {
  if (phases.length === 0) return null;
  const ordered = [...phases].sort((a, b) => a.position - b.position);

  let absoluteBase = 0;
  for (const phase of ordered) {
    const offset = daysBetween(phase.startsOn, iso);
    const weeksIn = Math.floor(offset / 7);
    if (offset >= 0 && weeksIn < phase.weeks) {
      return {
        phase,
        week: weeksIn + 1,
        absoluteWeek: absoluteBase + weeksIn + 1,
        dayIndex: ((offset % 7) + 7) % 7,
        date: iso,
      };
    }
    absoluteBase += phase.weeks;
  }

  const first = ordered[0];
  if (daysBetween(first.startsOn, iso) < 0) {
    return {
      phase: first,
      week: 1,
      absoluteWeek: 1,
      dayIndex: 0,
      date: first.startsOn,
    };
  }

  const last = ordered[ordered.length - 1];
  const totalBefore = ordered
    .slice(0, -1)
    .reduce((acc, p) => acc + p.weeks, 0);
  return {
    phase: last,
    week: last.weeks,
    absoluteWeek: totalBefore + last.weeks,
    dayIndex: 6,
    date: dateForPhaseDay(last, last.weeks, 6),
  };
}

/** Absolute program week → (phase, week inside phase). */
export function placeAbsoluteWeek(
  phases: PhaseSpan[],
  absoluteWeek: number,
): { phase: PhaseSpan; week: number } | null {
  const ordered = [...phases].sort((a, b) => a.position - b.position);
  let remaining = Math.max(1, absoluteWeek);
  for (const phase of ordered) {
    if (remaining <= phase.weeks) return { phase, week: remaining };
    remaining -= phase.weeks;
  }
  const last = ordered[ordered.length - 1];
  return last ? { phase: last, week: last.weeks } : null;
}

export function totalWeeks(phases: PhaseSpan[]): number {
  return phases.reduce((acc, p) => acc + p.weeks, 0);
}

/** Weeks from `iso` to the race, for the countdown. */
export function weeksUntil(iso: IsoDate, target: IsoDate): number {
  return Math.ceil(daysBetween(iso, target) / 7);
}
