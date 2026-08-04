import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";

/** Email confirmation and magic-link landing. */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/";

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      // Same-origin paths only: "//host" and "/\host" parse as external URLs.
      const path =
        next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\")
          ? next
          : "/";
      return NextResponse.redirect(`${origin}${path}`);
    }
  }

  return NextResponse.redirect(`${origin}/entrar?error=enlace_invalido`);
}
