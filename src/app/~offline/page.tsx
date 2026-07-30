import { OfflineShell } from "./offline-shell";

/**
 * The app shell the service worker serves when a navigation cannot
 * reach the network. Everything below renders from IndexedDB.
 */
export const dynamic = "force-static";

export default function OfflinePage() {
  return <OfflineShell />;
}
