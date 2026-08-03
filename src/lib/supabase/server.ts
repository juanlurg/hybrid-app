import { cache } from "react";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

import type { Database } from "./database.types";

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable ${name}`);
  return value;
}

/**
 * Request-scoped client that reads the athlete's session from cookies.
 * Every query it makes runs under RLS as that athlete.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(
    env("NEXT_PUBLIC_SUPABASE_URL"),
    env("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Called from a Server Component: middleware already refreshed
            // the session, so there is nothing to do here.
          }
        },
      },
    },
  );
}

/**
 * Service-role client. Bypasses RLS — only for code paths that have
 * already established which athlete they are acting for.
 */
export function createAdminClient() {
  return createSupabaseClient<Database>(
    env("NEXT_PUBLIC_SUPABASE_URL"),
    env("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

/**
 * The signed-in user, or null. Verifies the JWT locally via `getClaims()`
 * (asymmetric keys in prod, so no Auth round trip) and is cached per
 * request — layout, page and `loadAthlete` share one verification.
 */
export const getUser = cache(async () => {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (!claims?.sub) return null;
  return { id: claims.sub, email: claims.email ?? null };
});
