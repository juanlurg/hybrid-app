"use client";

import { useEffect } from "react";

import type { ExerciseHistory } from "@/lib/data/history";
import { openOfflineStore } from "@/lib/offline/db";

export const HISTORY_KEY = "history";

/**
 * Keeps today's "última vez" on the device, beside the plan snapshot, so
 * a session started with no signal still shows it. Renders nothing.
 */
export function HistoryWriter({ history }: { history: ExerciseHistory }) {
  useEffect(() => {
    const store = openOfflineStore();
    void (async () => {
      try {
        const stored =
          (await store.get<ExerciseHistory>("snapshot", HISTORY_KEY)) ?? {};
        await store.put("snapshot", HISTORY_KEY, { ...stored, ...history });
      } catch {
        // No IndexedDB: the line simply does not show offline.
      }
    })();
  }, [history]);

  return null;
}
