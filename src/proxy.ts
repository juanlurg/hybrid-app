import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// /~offline is public: it renders purely from IndexedDB and the service
// worker precaches it at install time, possibly before the first login —
// behind auth, the precache stored the /entrar redirect and the offline
// shell was permanently dead on any device installed while signed out.
const PUBLIC_PATHS = ["/entrar", "/registro", "/recuperar", "/auth", "/~offline"];

/**
 * Runs on every navigation. Two jobs, in this order:
 *  1. refresh the Supabase session cookie, so Server Components never see
 *     an expired token;
 *  2. decide whether this request is allowed through.
 *
 * The refresh has to happen before any redirect returns, or a user with a
 * stale-but-renewable session gets bounced to the login screen.
 */
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  const isPublic = PUBLIC_PATHS.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );

  // The daily cron has no cookie; the route enforces CRON_SECRET itself.
  if (pathname === "/api/keepalive") {
    return response;
  }

  if (!user && !isPublic) {
    // API callers (the sync queue, the export link fetched by a script)
    // need to tell "no session" apart from "here is the login page HTML".
    if (pathname.startsWith("/api/")) {
      return NextResponse.json(
        { ok: false, error: "not_authenticated" },
        { status: 401 },
      );
    }
    const url = request.nextUrl.clone();
    url.pathname = "/entrar";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  if (user && (pathname === "/entrar" || pathname === "/registro")) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * Everything except static assets and images — the session refresh
     * is pointless there and costs a round trip.
     */
    "/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|sw.js|icons/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
