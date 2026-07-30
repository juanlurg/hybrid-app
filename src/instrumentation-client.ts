/**
 * Runs after the HTML loads and before React hydrates (Next 15.3+
 * convention). Two jobs: register the service worker and kick the
 * first flush of anything a previous visit left in the queue.
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

attachSyncTriggers();
