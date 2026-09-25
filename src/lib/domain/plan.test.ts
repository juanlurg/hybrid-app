import { describe, expect, it } from "vitest";

import { priorityRank } from "./plan";

describe("priorityRank", () => {
  const f2 = "Fuerza A > Fuerza B > Z2 sábado > Fuerza C > Z2 martes";

  it("matches a step by the day's title", () => {
    expect(priorityRank(f2, { title: "Fuerza A", dayIndex: 0 })).toBe(0);
    expect(priorityRank(f2, { title: "Fuerza C", dayIndex: 4 })).toBe(3);
  });

  it("matches a step by the weekday it names", () => {
    expect(priorityRank(f2, { title: "Carrera larga", dayIndex: 5 })).toBe(2);
    expect(priorityRank(f2, { title: "Carrera", dayIndex: 1 })).toBe(4);
  });

  it("matches a distinctive word, never a generic one", () => {
    const f4 = "Tirada larga > Calidad > Fuerza A > Z2 miércoles > Fuerza B";
    expect(priorityRank(f4, { title: "Carrera larga", dayIndex: 5 })).toBe(0);
    expect(priorityRank(f4, { title: "Carrera calidad", dayIndex: 1 })).toBe(1);
    // "Carrera" alone must not claim "Tirada larga" or "Calidad".
    expect(priorityRank(f4, { title: "Carrera", dayIndex: 6 })).toBe(5);
  });

  it("ranks an unnamed day after every step", () => {
    expect(priorityRank(f2, { title: "Movilidad", dayIndex: 3 })).toBe(5);
    expect(priorityRank("", { title: "Fuerza A", dayIndex: 0 })).toBe(0);
  });
});
