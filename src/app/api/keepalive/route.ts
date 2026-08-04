import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * One trivial query a day so the free-tier Supabase project never
 * pauses for inactivity — the F1 Camino block is three weeks of zero
 * app usage landing exactly on the season's most important transition.
 * Driven by the vercel.json cron: Vercel sends `Authorization: Bearer
 * $CRON_SECRET` automatically once the env var exists. Fails closed —
 * an unset CRON_SECRET means 401 for everyone, never an open endpoint.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  // The service client keeps the ping independent of any browser session;
  // fine behind the secret, since the response only ever carries { ok }.
  const supabase = createAdminClient();
  const { error } = await supabase.from("profiles").select("id").limit(1);
  if (error) {
    console.error("[keepalive] query failed", { message: error.message });
    return NextResponse.json({ ok: false }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
