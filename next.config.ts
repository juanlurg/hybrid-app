import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Historial became Progreso; the engine's side of the old Progreso
  // (the per-lift breakdown, `?lift=`) became /motor.
  async redirects() {
    return [
      { source: "/historial", destination: "/progreso", permanent: false },
      {
        source: "/progreso",
        has: [{ type: "query", key: "lift" }],
        destination: "/motor",
        permanent: false,
      },
    ];
  },
  async headers() {
    return [
      {
        // The service worker must never be cached: a stale worker keeps
        // serving a stale shell long after a deploy.
        source: "/sw.js",
        headers: [
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
        ],
      },
    ];
  },
};

export default nextConfig;
