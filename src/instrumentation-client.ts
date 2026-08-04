/**
 * Runs after the HTML loads and before React hydrates (Next 15.3+
 * convention). Three jobs: register the service worker, ask for
 * persistent storage, and kick the first flush of anything a previous
 * visit left in the queue.
 */

import { attachSyncTriggers } from "@/lib/offline/syncer";

if (typeof window !== "undefined" && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/sw.js", { scope: "/", updateViaCache: "none" })
      .catch(() => {
        // Private mode or unsupported: the app still works online.
      });
  });
}

if (typeof window !== "undefined") {
  // The IndexedDB queue may hold the only copy of unsynced sessions;
  // ask the browser not to evict it. Fire-and-forget — a denial changes
  // nothing here, sync-status surfaces persisted() when it matters.
  void navigator.storage?.persist().catch(() => {});
}

attachSyncTriggers();
