/**
 * The serialized AthleteContext the offline shell renders from. Written
 * on every online render of the (app) layout — the data already rode
 * the RSC payload, persisting it costs nothing — and read back when
 * there is no network. `resolveDay`/`resolveExercise` are pure, so the
 * shell recomputes today's weights from this alone.
 */

import type { EngineConfig } from "@/lib/engine";
import type { AthleteContext } from "@/lib/domain/plan";

export const SNAPSHOT_SCHEMA_VERSION = 3;
export const SNAPSHOT_KEY = "athlete";

export interface AthleteSnapshot {
  schemaVersion: number;
  revision: string;
  savedAt: string;
  userId: string;
  ctx: AthleteContext;
  config: EngineConfig;
  seasonWeeks: number;
}

/**
 * Cheap stable hash of the payload, to skip rewrites when nothing
 * changed. djb2 over the JSON — collisions only cost a redundant write.
 */
export function snapshotRevision(payload: unknown): string {
  const json = JSON.stringify(payload);
  let h = 5381;
  for (let i = 0; i < json.length; i++) {
    h = ((h << 5) + h + json.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(36);
}

export function buildSnapshot(input: {
  userId: string;
  ctx: AthleteContext;
  config: EngineConfig;
  seasonWeeks: number;
  savedAt: string;
}): AthleteSnapshot {
  return {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    revision: snapshotRevision({ ctx: input.ctx, config: input.config }),
    savedAt: input.savedAt,
    userId: input.userId,
    ctx: input.ctx,
    config: input.config,
    seasonWeeks: input.seasonWeeks,
  };
}

/**
 * A snapshot is only trusted when it speaks this schema version and
 * belongs to this user. Anything else → null → the shell says "sin
 * datos" instead of rendering another athlete's plan or a stale shape.
 */
export function validateSnapshot(
  raw: unknown,
  expectedUserId?: string,
): AthleteSnapshot | null {
  if (raw == null || typeof raw !== "object") return null;
  const s = raw as Partial<AthleteSnapshot>;
  if (s.schemaVersion !== SNAPSHOT_SCHEMA_VERSION) return null;
  if (!s.userId || !s.ctx || !s.config || !s.savedAt) return null;
  if (expectedUserId && s.userId !== expectedUserId) return null;
  if (!Array.isArray(s.ctx.phases) || !Array.isArray(s.ctx.exercises)) {
    return null;
  }
  return s as AthleteSnapshot;
}
