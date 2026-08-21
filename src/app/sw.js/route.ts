/**
 * The service worker, served as a route so every deploy ships a fresh
 * CACHE_VERSION — the old static public/sw.js never changed bytes, so
 * the install event never re-fired and the precached shell (and the
 * hashed chunk URLs inside it) went stale forever after one deploy.
 *
 * `force-static` bakes the version at build time; the proxy matcher
 * already lets /sw.js through unauthenticated, and next.config.ts sets
 * the no-cache headers on the path.
 *
 * Strategy (unchanged from the hand-rolled worker):
 *  · precache the offline shell (/~offline) + its hydration chunks +
 *    manifest + icons — the chunks are parsed out of the shell's own
 *    HTML, so hydration works offline even if the route was never
 *    visited online;
 *  · navigations go network-first with a short timeout, falling back
 *    to the shell — per-user HTML is NEVER cached;
 *  · hashed /_next/static assets are cache-first (immutable);
 *  · POSTs, /api/*, /auth/* and RSC prefetches are never touched.
 */

export const dynamic = "force-static";

const CACHE_VERSION =
  process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 12) ?? "dev";

const WORKER_SOURCE = /* js */ (
  'const CACHE_VERSION = "' + CACHE_VERSION + '";\n' +
  `const PRECACHE = "bloques-pre-" + CACHE_VERSION;
const RUNTIME = "bloques-run-" + CACHE_VERSION;

const SHELL_URL = "/~offline";
const STATIC_URLS = [
  "/manifest.webmanifest",
  "/icons/icon-192.svg",
  "/icons/icon-512.svg",
];

// Last resort for lie-fi (a connection that hangs without failing). A
// real network error falls back to the shell immediately via catch; the
// timer must sit far above a cold start + full render, or a slow-but-
// alive navigation gets hijacked into the offline shell while online.
const NETWORK_TIMEOUT_MS = 12000;

// Fetch the shell rejecting redirects (a redirect here means auth got in
// the way — cache nothing, fail the install loudly, the old worker keeps
// serving), then precache the hashed chunks its HTML references so the
// client component actually hydrates offline.
async function precacheShell(cache) {
  const res = await fetch(SHELL_URL, {
    redirect: "error",
    cache: "no-cache",
    credentials: "same-origin",
  });
  if (!res.ok || res.redirected) {
    throw new Error("shell precache got " + res.status);
  }
  const html = await res.clone().text();
  const chunks = [
    ...new Set(html.match(/\\/_next\\/static\\/[^"'\\\\ ]+\\.(?:js|css)/g) ?? []),
  ];
  await cache.addAll(STATIC_URLS.concat(chunks));
  await cache.put(SHELL_URL, res);
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(PRECACHE)
      .then((cache) => precacheShell(cache))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k.indexOf("bloques-") === 0 && k !== PRECACHE && k !== RUNTIME)
            .map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

function networkFirstNavigation(request) {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      caches.match(SHELL_URL).then((cached) => {
        resolve(cached ?? Response.error());
      });
    }, NETWORK_TIMEOUT_MS);

    fetch(request)
      .then((response) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(response);
      })
      .catch(() => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        caches.match(SHELL_URL).then((cached) => {
          resolve(cached ?? Response.error());
        });
      });
  });
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) {
    const cache = await caches.open(RUNTIME);
    cache.put(request, response.clone());
  }
  return response;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;
  if (url.pathname.startsWith("/auth/")) return;
  // RSC payload fetches carry their own semantics — let them fail fast
  // offline so the router surfaces the error instead of stale HTML.
  if (request.headers.get("RSC") || url.searchParams.has("_rsc")) return;

  if (request.mode === "navigate") {
    event.respondWith(networkFirstNavigation(request));
    return;
  }

  if (
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/icons/") ||
    url.pathname === "/manifest.webmanifest"
  ) {
    event.respondWith(cacheFirst(request));
  }
});

// Tapping the session notification brings the open tab back — the
// runner is almost certainly the screen that posted it.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((list) => {
        const client = list.find((c) => "focus" in c);
        return client ? client.focus() : self.clients.openWindow("/");
      }),
  );
});
`
);

export function GET() {
  return new Response(WORKER_SOURCE, {
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      "Cache-Control": "no-cache, no-store, must-revalidate",
    },
  });
}
