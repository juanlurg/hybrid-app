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
