import { describe, expect, it } from "vitest";

import { DEFAULT_ENGINE_CONFIG } from "@/lib/engine";

import { priorityRank, resolveExercise, type ProgramExerciseRow } from "./plan";

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

describe("resolveExercise · technique GIF", () => {
  const row = {
    id: "pe-1",
    exercise_id: "cat-1",
    position: 0,
    name: "Fondos",
    sets: 3,
    rep_min: 8,
    rep_max: 10,
    rest_seconds: 120,
    is_primary: false,
    load_mode: "bodyweight",
    effort: "reps",
  } as ProgramExerciseRow;
  const resolve = (r: ProgramExerciseRow, slugs: Record<string, string>) =>
    resolveExercise(r, 1, DEFAULT_ENGINE_CONFIG, new Map(), slugs);

  it("follows the catalogue slug to its GIF", () => {
    expect(resolve(row, { "cat-1": "fondos" }).gif).toBe(
      "/ejercicios/0251-9WTm7dq.gif",
    );
  });

  it("has none off the catalogue or for a slug without one", () => {
    expect(resolve({ ...row, exercise_id: null }, {}).gif).toBeNull();
    expect(resolve(row, { "cat-1": "mi-ejercicio" }).gif).toBeNull();
  });
});
