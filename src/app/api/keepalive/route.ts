import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * One trivial query a day so the free-tier Supabase project never
 * pauses for inactivity — a holiday or an injury layoff must not
 * take the database down with it.
 * Driven by the vercel.json cron; a CRON_SECRET, when set, keeps
 * strangers from burning invocations.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = request.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ ok: false }, { status: 401 });
    }
  }

  const supabase = createAdminClient();
  const { error } = await supabase.from("profiles").select("id").limit(1);
  if (error) {
    console.error("[keepalive] query failed", { message: error.message });
    return NextResponse.json({ ok: false }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
