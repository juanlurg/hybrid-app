import { describe, expect, it } from "vitest";

import { DEFAULT_ENGINE_CONFIG } from "@/lib/engine";
import type { AthleteContext } from "@/lib/domain/plan";
import {
  buildSnapshot,
  SNAPSHOT_SCHEMA_VERSION,
  snapshotRevision,
  validateSnapshot,
} from "./snapshot";

/** The smallest ctx the validator accepts; shape only, tests never resolve it. */
const ctx = { phases: [], exercises: [] } as unknown as AthleteContext;

const snap = () =>
  buildSnapshot({
    userId: "u-1",
    ctx,
    config: DEFAULT_ENGINE_CONFIG,
    seasonWeeks: 39,
    savedAt: "2026-09-14T08:00:00Z",
  });

describe("snapshot", () => {
  it("round-trips through validation for the same user", () => {
    expect(validateSnapshot(snap(), "u-1")).not.toBeNull();
  });

  it("another user's snapshot is rejected — never render someone else's plan", () => {
    expect(validateSnapshot(snap(), "u-2")).toBeNull();
  });

  it("a schema bump invalidates old snapshots", () => {
    const old = { ...snap(), schemaVersion: SNAPSHOT_SCHEMA_VERSION - 1 };
    expect(validateSnapshot(old, "u-1")).toBeNull();
  });

  it("junk is rejected", () => {
    expect(validateSnapshot(null)).toBeNull();
    expect(validateSnapshot("{}")).toBeNull();
    expect(validateSnapshot({ userId: "u-1" })).toBeNull();
  });

  it("revision is stable for equal payloads and differs when data changes", () => {
    const a = snapshotRevision({ x: 1 });
    expect(snapshotRevision({ x: 1 })).toBe(a);
    expect(snapshotRevision({ x: 2 })).not.toBe(a);
  });
});
