import { describe, expect, it } from "vitest";

import {
  addDays,
  dateForPhaseDay,
  dayIndexOf,
  daysBetween,
  formatDayLong,
  formatSeasonRange,
  phaseEnd,
  placeAbsoluteWeek,
  placeDate,
  startOfWeek,
  totalWeeks,
  weeksUntil,
  type PhaseSpan,
} from "./calendar";

// The Plan Maestro, exactly as seeded.
const PHASES: PhaseSpan[] = [
  { id: "f0b", key: "F0-bis", name: "Readaptación extendida", position: 1, weeks: 4, startsOn: "2026-08-17" },
  { id: "f2", key: "F2", name: "Hipertrofia / Fuerza", position: 2, weeks: 12, startsOn: "2026-09-14" },
  { id: "f3", key: "F3", name: "Base híbrida", position: 3, weeks: 8, startsOn: "2026-12-07" },
  { id: "f4", key: "F4", name: "Específico media", position: 4, weeks: 12, startsOn: "2027-02-01" },
];

describe("date maths", () => {
  it("adds days across month boundaries", () => {
    expect(addDays("2026-08-30", 3)).toBe("2026-09-02");
    expect(addDays("2027-03-01", -1)).toBe("2027-02-28");
  });

  it("counts days between", () => {
    expect(daysBetween("2026-07-27", "2026-08-24")).toBe(28);
    expect(daysBetween("2026-08-24", "2026-07-27")).toBe(-28);
  });

  it("treats Monday as day 0", () => {
    expect(dayIndexOf("2026-07-27")).toBe(0); // Monday
    expect(dayIndexOf("2026-08-02")).toBe(6); // Sunday
  });

  it("snaps to the Monday of the week", () => {
    expect(startOfWeek("2026-07-30")).toBe("2026-07-27");
    expect(startOfWeek("2026-07-27")).toBe("2026-07-27");
  });

  it("survives a DST boundary", () => {
    // Spain moves the clocks on the last Sunday of October.
    expect(addDays("2026-10-24", 7)).toBe("2026-10-31");
    expect(daysBetween("2026-10-24", "2026-10-31")).toBe(7);
  });

  it("formats the way the screens do", () => {
    expect(formatDayLong("2026-10-14")).toBe("MIÉ 14 OCT");
    expect(formatSeasonRange("2026-07-27", "2027-04-25")).toBe("jul 26 → abr 27");
  });
});

describe("season placement", () => {
  it("puts the phase boundaries exactly where the plan says", () => {
    expect(placeDate(PHASES, "2026-08-17")).toMatchObject({ week: 1, absoluteWeek: 1, dayIndex: 0 });
    expect(placeDate(PHASES, "2026-09-14")?.phase.key).toBe("F2");
    expect(placeDate(PHASES, "2026-12-07")?.phase.key).toBe("F3");
    expect(placeDate(PHASES, "2027-02-01")?.phase.key).toBe("F4");
  });

  it("finds the week inside a phase", () => {
    // F2 week 6, Wednesday.
    const p = placeDate(PHASES, "2026-10-21");
    expect(p).toMatchObject({ week: 6, dayIndex: 2 });
    expect(p?.phase.key).toBe("F2");
    expect(p?.absoluteWeek).toBe(4 + 6);
  });

  it("clamps before the season starts", () => {
    const p = placeDate(PHASES, "2026-06-01");
    expect(p).toMatchObject({ week: 1, absoluteWeek: 1 });
    expect(p?.phase.key).toBe("F0-bis");
  });

  it("clamps after the season ends", () => {
    const p = placeDate(PHASES, "2027-09-01");
    expect(p?.phase.key).toBe("F4");
    expect(p?.week).toBe(12);
  });

  it("maps an absolute week back to a phase", () => {
    expect(placeAbsoluteWeek(PHASES, 1)).toMatchObject({ week: 1 });
    expect(placeAbsoluteWeek(PHASES, 5)?.phase.key).toBe("F2");
    expect(placeAbsoluteWeek(PHASES, 5)?.week).toBe(1);
    expect(placeAbsoluteWeek(PHASES, 36)?.phase.key).toBe("F4");
    expect(placeAbsoluteWeek(PHASES, 36)?.week).toBe(12);
  });

  it("knows the season is 36 weeks", () => {
    expect(totalWeeks(PHASES)).toBe(36);
  });

  it("computes a phase's last day", () => {
    expect(phaseEnd(PHASES[0])).toBe("2026-09-13");
    expect(phaseEnd(PHASES[3])).toBe("2027-04-25");
  });

  it("locates a specific training day", () => {
    // F2 week 1, Monday = 14 Sep 2026.
    expect(dateForPhaseDay(PHASES[1], 1, 0)).toBe("2026-09-14");
    // F2 week 12, Sunday.
    expect(dateForPhaseDay(PHASES[1], 12, 6)).toBe("2026-12-06");
  });

  it("counts down to the race", () => {
    expect(weeksUntil("2027-04-04", "2027-04-25")).toBe(3);
  });

  it("returns null with no phases", () => {
    expect(placeDate([], "2026-07-27")).toBeNull();
  });
});
