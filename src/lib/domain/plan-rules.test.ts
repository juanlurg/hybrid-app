import { describe, expect, it } from "vitest";

import { newBlockingTitles, planWarnings } from "./plan-rules";
import type { SessionType } from "./plan";

function slot(id: string, sessionType: SessionType, label = id.toUpperCase()) {
  return { id, label, sessionType };
}

const STRENGTH_WEEK = {
  slots: [
    slot("a", "strength", "FUERZA A"),
    slot("run", "run_easy"),
    slot("mov", "mobility"),
    slot("off", "rest"),
  ],
  exercises: [
    { slotId: "a", sets: 3, isPrimary: true },
    { slotId: "a", sets: 3, isPrimary: false },
  ],
  days: [
    { dayIndex: 0, slotId: "a" },
    { dayIndex: 1, slotId: "run" },
    { dayIndex: 2, slotId: "mov" },
    { dayIndex: 3, slotId: "off" },
    { dayIndex: 4, slotId: "off" },
    { dayIndex: 5, slotId: "off" },
    { dayIndex: 6, slotId: "off" },
  ],
};

describe("planWarnings", () => {
  it("a training week without mobility is a blocking failure", () => {
    const days = STRENGTH_WEEK.days.map((d) =>
      d.slotId === "mov" ? { ...d, slotId: "off" } : d,
    );
    const w = planWarnings({ ...STRENGTH_WEEK, days });
    expect(
      w.some((x) => x.title === "Sin bloque de movilidad" && x.blocking),
    ).toBe(true);
  });

  it("a week with no strength at all is legitimately mobility-free — F1, caminar ES el entreno", () => {
    const camino = {
      slots: [slot("camino", "run_long", "CAMINO")],
      exercises: [],
      days: Array.from({ length: 7 }, (_, i) => ({
        dayIndex: i,
        slotId: "camino",
      })),
    };
    const w = planWarnings(camino);
    expect(w.some((x) => x.title === "Sin bloque de movilidad")).toBe(false);
  });

  it("a strength slot without a basic blocks", () => {
    const w = planWarnings({
      ...STRENGTH_WEEK,
      exercises: [{ slotId: "a", sets: 3, isPrimary: false }],
    });
    expect(w.some((x) => x.title === "FUERZA A sin básico" && x.blocking)).toBe(
      true,
    );
  });

  it("a clean strength week passes", () => {
    expect(planWarnings(STRENGTH_WEEK).filter((w) => w.blocking)).toEqual([]);
  });
});

describe("quality run the day after heavy legs", () => {
  const TITLE = "Fricción · PIERNA el día antes de la calidad";
  const week = (legsDay: number, qualityDay: number, liftKey: string) => ({
    slots: [
      slot("legs", "strength", "PIERNA"),
      slot("quality", "run_quality"),
      slot("mov", "mobility"),
      slot("off", "rest"),
    ],
    exercises: [
      { slotId: "legs", sets: 3, isPrimary: true, liftKey },
      { slotId: "legs", sets: 3, isPrimary: false },
    ],
    days: Array.from({ length: 7 }, (_, i) => ({
      dayIndex: i,
      slotId: i === legsDay ? "legs" : i === qualityDay ? "quality" : i === 2 ? "mov" : "off",
    })),
  });

  it("warns — advisory, not blocking — on the 24 h adjacency", () => {
    const w = planWarnings(week(0, 1, "sentadilla"));
    const hit = w.find((x) => x.title === TITLE);
    expect(hit).toBeDefined();
    expect(hit!.blocking).toBe(false);
  });

  it("48 h of separation is fine", () => {
    const w = planWarnings(week(0, 3, "sentadilla"));
    expect(w.some((x) => x.title === TITLE)).toBe(false);
  });

  it("an upper-body primary does not trigger it", () => {
    const w = planWarnings(week(0, 1, "banca"));
    expect(w.some((x) => x.title === TITLE)).toBe(false);
  });

  it("Sunday → Monday wraps", () => {
    const w = planWarnings(week(6, 0, "rdl"));
    expect(w.some((x) => x.title === TITLE)).toBe(true);
  });
});

describe("newBlockingTitles", () => {
  it("only violations the batch introduced count — pre-existing ones never veto", () => {
    const pre = planWarnings({
      ...STRENGTH_WEEK,
      days: STRENGTH_WEEK.days.map((d) =>
        d.slotId === "mov" ? { ...d, slotId: "off" } : d,
      ),
    });
    const post = planWarnings({
      ...STRENGTH_WEEK,
      exercises: [{ slotId: "a", sets: 3, isPrimary: false }],
      days: STRENGTH_WEEK.days.map((d) =>
        d.slotId === "mov" ? { ...d, slotId: "off" } : d,
      ),
    });
    // Mobility was already missing before the batch; the batch only
    // orphaned the basic — that alone should block.
    expect(newBlockingTitles(pre, post)).toEqual(["FUERZA A sin básico"]);
  });

  it("no new violations → nothing blocks", () => {
    const w = planWarnings(STRENGTH_WEEK);
    expect(newBlockingTitles(w, w)).toEqual([]);
  });
});
