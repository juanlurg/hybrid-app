/**
 * Hand-rolled service worker — Serwist wants webpack and this repo
 * builds with Turbopack, so the ~80 lines are written out.
 *
 * Strategy:
 *  · precache the offline shell (/~offline) + manifest + icons;
 *  · navigations go network-first with a short timeout, falling back
 *    to the shell — per-user HTML is NEVER cached;
 *  · hashed /_next/static assets are cache-first (immutable), which is
 *    what keeps an already-open shell working across a deploy;
 *  · POSTs, /api/*, /auth/* and RSC prefetches are never touched: the
 *    sync queue talks to the network directly.
 *
 * Bump CACHE_VERSION when the shell must be re-precached.
 */

const CACHE_VERSION = "v1";
const PRECACHE = `bloques-pre-${CACHE_VERSION}`;
const RUNTIME = `bloques-run-${CACHE_VERSION}`;

const SHELL_URL = "/~offline";
const PRECACHE_URLS = [
  SHELL_URL,
  "/manifest.webmanifest",
  "/icons/icon-192.svg",
  "/icons/icon-512.svg",
];

const NETWORK_TIMEOUT_MS = 3500;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(PRECACHE)
      .then((cache) => cache.addAll(PRECACHE_URLS))
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
            .filter((k) => k.startsWith("bloques-") && k !== PRECACHE && k !== RUNTIME)
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
