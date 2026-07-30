import { describe, expect, it } from "vitest";

import {
  decoupling,
  formatPace,
  halfTargetPace,
  hrZones,
  prescriptionMinutes,
  runBlocks,
  zoneRange,
} from "./run";

describe("heart-rate zones", () => {
  it("derives the plan's table from LTHR", () => {
    const z = hrZones(168);
    expect(z.map((x) => x.key)).toEqual(["Z1", "Z2", "Z3", "Z4", "Z5"]);
    const z2 = z.find((x) => x.key === "Z2")!;
    expect(z2.loBpm).toBe(136); // 168 × 0.81
    expect(z2.hiBpm).toBe(150); // 168 × 0.89
  });

  it("leaves Z5 open at the top", () => {
    expect(hrZones(168).at(-1)!.hiBpm).toBeNull();
    expect(zoneRange(168, "Z5")).toBe("≥ 168 ppm");
  });

  it("formats a range", () => {
    expect(zoneRange(168, "Z2")).toBe("136–150 ppm");
  });
});

describe("prescription minutes", () => {
  it("sums plain durations", () => {
    expect(prescriptionMinutes("45' Z2")).toBe(45);
    expect(prescriptionMinutes("40' Z2 + 4 strides 20\"")).toBe(40);
  });

  it("expands interval notation", () => {
    // 10 + 8 + 10 warm/cool, plus two more 8' reps
    expect(prescriptionMinutes("10' Z2 + 3×8' Z4 (rec 3') + 10' Z2")).toBe(47);
  });

  it("falls back to distance for the long runs", () => {
    expect(prescriptionMinutes("18 km, 6 km a RM al final")).toBe(99);
  });

  it("returns zero for an empty prescription", () => {
    expect(prescriptionMinutes("")).toBe(0);
  });
});

describe("run blocks", () => {
  it("builds the LTHR test", () => {
    const b = runBlocks("Test LTHR 30'", 168);
    expect(b).toHaveLength(3);
    expect(b[1].title).toBe("Test de umbral");
    expect(b[1].tone).toBe("hard");
    expect(b[1].note).toContain("últimos 20 minutos");
  });

  it("builds cruise intervals with the Z4 band", () => {
    const b = runBlocks("10' Z2 + 3×8' Z4 (rec 3') + 10' Z2", 168);
    expect(b[1].title).toBe("3 × 8′ cruise intervals");
    expect(b[1].duration).toBe("24′ + rec 3′");
    expect(b[1].hr).toBe("158–166");
  });

  it("appends hills and strides to a Z2 run", () => {
    const b = runBlocks('45\' Z2 + 6 cuestas 20"', 168);
    const titles = b.map((x) => x.title);
    expect(titles).toContain("6 × cuesta 20″");
    expect(titles.at(-1)).toBe("Vuelta a la calma");
  });

  it("handles a plain long run", () => {
    const b = runBlocks("90' Z2, últimos 10' progresivos", 168);
    expect(b[1].title).toBe("Rodaje continuo");
    expect(b[1].hr).toBe("136–150 ppm");
  });
});

describe("Pa:HR decoupling", () => {
  it("is zero when pace and heart rate hold", () => {
    expect(
      decoupling(
        { paceSecPerKm: 330, avgHr: 145 },
        { paceSecPerKm: 330, avgHr: 145 },
      ),
    ).toBe(0);
  });

  it("goes positive when the heart rate drifts up at the same pace", () => {
    const d = decoupling(
      { paceSecPerKm: 330, avgHr: 140 },
      { paceSecPerKm: 330, avgHr: 150 },
    );
    expect(d).toBeGreaterThan(6);
    expect(d).toBeLessThan(7);
  });
});

describe("race pace", () => {
  it("derives half pace from a 10K", () => {
    // 45:00 for 10K → 4:30/km → 4:45–4:50/km
    const p = halfTargetPace(45 * 60);
    expect(formatPace(p.loSecPerKm)).toBe("4:45");
    expect(formatPace(p.hiSecPerKm)).toBe("4:50");
  });
});
