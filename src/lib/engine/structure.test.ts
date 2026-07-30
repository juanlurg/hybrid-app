import { describe, expect, it } from "vitest";

import {
  parseStructure,
  structuredBlocks,
  structureMinutes,
  type RunStructure,
} from "./run";

const LTHR = 170; // Z2 138–151 · Z4 160–168

describe("parseStructure", () => {
  it("accepts a well-formed block list", () => {
    const s = parseStructure([{ kind: "steady", workMin: 45, zone: "Z2" }]);
    expect(s).not.toBeNull();
  });

  it("rejects junk, empty arrays and unknown kinds → legacy parser", () => {
    expect(parseStructure(null)).toBeNull();
    expect(parseStructure([])).toBeNull();
    expect(parseStructure([{ kind: "zumba" }])).toBeNull();
    expect(parseStructure("45' Z2")).toBeNull();
  });
});

describe("structuredBlocks", () => {
  it("renders 6×3' Z5 as VO2 work, not as a Z2 jog", () => {
    // The regex parser required a literal "Z4" and silently degraded
    // this exact F4 session to "Rodaje continuo Z2".
    const s: RunStructure = [
      { kind: "interval", repeat: 6, workMin: 3, zone: "Z5", recMin: 2.5 },
    ];
    const blocks = structuredBlocks(s, LTHR);
    expect(blocks.map((b) => b.title)).toEqual([
      "Calentamiento",
      "6 × 3′ Z5",
      "Vuelta a la calma",
    ]);
    expect(blocks[1].tone).toBe("hard");
    expect(blocks[1].duration).toBe("18′ + rec 2′30″");
  });

  it("renders km repeats at race pace", () => {
    const s: RunStructure = [
      { kind: "interval", repeat: 3, workKm: 3, zone: "RM", recMin: 3 },
    ];
    const blocks = structuredBlocks(s, LTHR);
    expect(blocks[1].title).toBe("3 × 3 km a RM");
    expect(blocks[1].hr).toBe("ritmo de media, no pulso");
  });

  it("a Z2 run with hills keeps the run as written and cools down 5′", () => {
    const s: RunStructure = [
      { kind: "steady", workMin: 45, zone: "Z2" },
      { kind: "hills", repeat: 6, workSec: 20 },
    ];
    const blocks = structuredBlocks(s, LTHR);
    expect(blocks[0].title).toBe("Rodaje continuo");
    expect(blocks[1].title).toBe("6 × cuesta 20″");
    expect(blocks.at(-1)?.title).toBe("Vuelta a la calma");
    expect(blocks.at(-1)?.duration).toBe("5′");
  });

  it("kind test expands to the canonical LTHR trio", () => {
    const blocks = structuredBlocks([{ kind: "test", workMin: 30 }], LTHR);
    expect(blocks.map((b) => b.title)).toEqual([
      "Calentamiento",
      "Test de umbral",
      "Vuelta a la calma",
    ]);
  });

  it("races render as written — no warm-up blocks around a half marathon", () => {
    const blocks = structuredBlocks(
      [{ kind: "race", workKm: 21.1, zone: "RM" }],
      LTHR,
    );
    expect(blocks).toHaveLength(1);
    expect(blocks[0].duration).toBe("21,1 km");
  });

  it("rest produces nothing", () => {
    expect(structuredBlocks([{ kind: "rest" }], LTHR)).toEqual([]);
  });

  it("RM segments inside a long run stay visible", () => {
    const s: RunStructure = [
      { kind: "steady", workKm: 12, zone: "Z2" },
      { kind: "steady", workKm: 6, zone: "RM", note: "Al final." },
    ];
    const blocks = structuredBlocks(s, LTHR);
    const rm = blocks.find((b) => b.title === "A ritmo de media");
    expect(rm).toBeDefined();
    expect(rm?.duration).toBe("6 km");
  });
});

describe("structureMinutes", () => {
  it("charges work plus the recoveries between reps", () => {
    // 3×8 = 24 of work + 2 recoveries of 3.
    expect(
      structureMinutes([
        { kind: "interval", repeat: 3, workMin: 8, zone: "Z4", recMin: 3 },
      ]),
    ).toBe(30);
  });

  it("sums mixed sessions", () => {
    expect(
      structureMinutes([
        { kind: "steady", workMin: 10, zone: "Z2" },
        { kind: "interval", repeat: 2, workMin: 8, zone: "Z4", recMin: 3 },
        { kind: "steady", workMin: 10, zone: "Z2" },
      ]),
    ).toBe(39);
  });

  it("estimates km at the same 5:30 ballpark as the legacy parser", () => {
    expect(structureMinutes([{ kind: "steady", workKm: 12, zone: "Z2" }])).toBe(66);
  });

  it("hills and strides cost about a minute and a half each", () => {
    expect(structureMinutes([{ kind: "hills", repeat: 6, workSec: 20 }])).toBe(9);
  });
});
