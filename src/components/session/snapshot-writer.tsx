"use client";

import { useEffect } from "react";

import type { EngineConfig } from "@/lib/engine";
import type { AthleteContext } from "@/lib/domain/plan";
import { openOfflineStore, wipeOfflineData } from "@/lib/offline/db";
import {
  buildSnapshot,
  SNAPSHOT_KEY,
  snapshotRevision,
  validateSnapshot,
} from "@/lib/offline/snapshot";
import { attachSyncTriggers } from "@/lib/offline/syncer";

/**
 * Rides every online render of the (app) layout. The data already
 * travelled in the RSC payload — persisting it to IndexedDB is what
 * lets the offline shell resolve today's session without a server.
 * Renders nothing.
 */
export function SnapshotWriter({
  userId,
  ctx,
  config,
  seasonWeeks,
}: {
  userId: string;
  ctx: AthleteContext;
  config: EngineConfig;
  seasonWeeks: number;
}) {
  useEffect(() => {
    attachSyncTriggers();
    const store = openOfflineStore();
    void (async () => {
      try {
        const stored = validateSnapshot(
          await store.get("snapshot", SNAPSHOT_KEY),
        );
        // Another athlete's data on this device: everything goes.
        if (stored && stored.userId !== userId) {
          await wipeOfflineData(store);
        }
        const revision = snapshotRevision({ ctx, config });
        if (stored?.userId === userId && stored.revision === revision) return;
        await store.put(
          "snapshot",
          SNAPSHOT_KEY,
          buildSnapshot({
            userId,
            ctx,
            config,
            seasonWeeks,
            savedAt: new Date().toISOString(),
          }),
        );
      } catch {
        // Private-mode Safari without IndexedDB: the app still works online.
      }
    })();
  }, [userId, ctx, config, seasonWeeks]);

  return null;
}
