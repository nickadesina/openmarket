import { type NextRequest, NextResponse } from "next/server";

/**
 * The archived v1 is read-only. Every write (any non-GET request to /api),
 * every sign-in route and every cron is refused here, before a route runs; the
 * pages that only exist to sign in or administer send the reader home.
 */
const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const CLOSED_API_PREFIXES = [
  "/api/t/auth/",
  "/api/cron/",
  "/api/t/cron/",
  "/api/admin/",
  "/api/t/admin/",
];
const CLOSED_PAGES = ["/t/signin", "/admin", "/t/admin"];

function archived(): NextResponse {
  return NextResponse.json(
    {
      error: {
        code: "ARCHIVED",
        message: "OpenMarket v1 is archived. Trading, sign-in and forecasting are closed.",
        details: {},
      },
    },
    { status: 403, headers: { "Cache-Control": "no-store" } },
  );
}

export function proxy(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;
  if (pathname.startsWith("/api/")) {
    if (!READ_METHODS.has(request.method)) return archived();
    if (CLOSED_API_PREFIXES.some((prefix) => pathname.startsWith(prefix))) return archived();
    return NextResponse.next();
  }
  if (CLOSED_PAGES.some((page) => pathname === page || pathname.startsWith(`${page}/`))) {
    return NextResponse.redirect(new URL("/", request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/api/:path*", "/t/signin", "/admin/:path*", "/admin", "/t/admin/:path*", "/t/admin"],
};
