import { describe, expect, it } from "vitest";

import type { LoadedAthlete } from "@/lib/data/athlete";
import { filterOwnedChanges } from "./proposal";
import { changeOpSchema } from "./schema";

const PHASE = "11111111-1111-4111-8111-111111111111";
const OTHER_PHASE = "22222222-2222-4222-8222-222222222222";
const RUN = "33333333-3333-4333-8333-333333333333";
const GYM = "44444444-4444-4444-8444-444444444444";
const OTHER_RUN = "55555555-5555-4555-8555-555555555555";

const athlete = {
  ctx: {
    phases: [
      { id: PHASE, weeks: 4 },
      { id: OTHER_PHASE, weeks: 6 },
    ],
    slots: [
      { id: RUN, phase_id: PHASE, session_type: "run_quality" },
      { id: GYM, phase_id: PHASE, session_type: "strength" },
      { id: OTHER_RUN, phase_id: OTHER_PHASE, session_type: "run_long" },
    ],
    exercises: [],
  },
} as unknown as LoadedAthlete;

const setRun = (over: Record<string, unknown> = {}) =>
  changeOpSchema.parse({
    op: "set_run",
    title: "Cruise intervals más largos",
    slotId: RUN,
    week: 2,
    prescription: "3×10' Z4 (rec 3')",
    structure: [{ kind: "interval", repeat: 3, workMin: 10, zone: "Z4", recMin: 3 }],
    ...over,
  });

describe("set_run", () => {
  it("needs the slot, the week, the label and the blocks", () => {
    for (const missing of ["slotId", "week", "prescription", "structure"]) {
      expect(() => setRun({ [missing]: null })).toThrow(/set_run necesita/);
    }
    expect(() => setRun({ structure: [] })).toThrow();
  });

  it("keeps a run week inside the phase", () => {
    const { kept, dropped } = filterOwnedChanges([setRun()], athlete, PHASE, new Map());
    expect(kept).toHaveLength(1);
    expect(dropped).toHaveLength(0);
  });

  it("drops a week the phase does not have", () => {
    const { dropped } = filterOwnedChanges([setRun({ week: 5 })], athlete, PHASE, new Map());
    expect(dropped[0].reason).toBe("la fase no tiene esa semana");
  });

  it("drops a strength slot and a slot from another phase", () => {
    const { dropped } = filterOwnedChanges(
      [setRun({ slotId: GYM }), setRun({ slotId: OTHER_RUN })],
      athlete,
      PHASE,
      new Map(),
    );
    expect(dropped.map((d) => d.reason)).toEqual([
      "solo se cambia la carrera de una sesión de carrera",
      "la sesión no pertenece a esta fase",
    ]);
  });
});
