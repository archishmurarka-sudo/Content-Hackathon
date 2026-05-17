// Single-password auth wall for the dashboard.
//
// Anything not in PUBLIC_PATHS requires the auth cookie set by /api/auth.
// Unauthenticated page requests get redirected to /login with ?next=<originalPath>.
// Unauthenticated API requests get a 401 JSON body so client fetches can react.
//
// What stays PUBLIC and why:
//   /login                     — the password form itself
//   /api/auth                  — POST sets the cookie (otherwise no way in)
//   /api/health                — Railway / monitoring probes
//   /api/assets/*              — videos & images linked from WhatsApp/email
//                                must be fetchable by browsers WITHOUT cookies
//   /handoff/*                 — creator-facing share page; URL is sent over WA
//   /pitch.html and proof image — pitch deck is shareable, gate-free

import { NextRequest, NextResponse } from "next/server";
import { authCookieName, dashboardPassword } from "@/lib/auth";

const PUBLIC_PREFIXES = [
  "/login",
  "/api/auth",
  "/api/health",
  "/api/assets",
  "/handoff",
];

const PUBLIC_FILES = new Set<string>([
  "/pitch.html",
  "/creator-ranking.png",
  "/favicon.ico",
]);

function isPublic(pathname: string): boolean {
  if (PUBLIC_FILES.has(pathname)) return true;
  for (const p of PUBLIC_PREFIXES) {
    if (pathname === p || pathname.startsWith(p + "/")) return true;
  }
  return false;
}

export function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;

  if (isPublic(pathname)) return NextResponse.next();

  const cookie = req.cookies.get(authCookieName())?.value;
  if (cookie && cookie === dashboardPassword()) return NextResponse.next();

  // API routes → 401 JSON.
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // Page → redirect to /login, preserving the original URL as ?next=
  const loginUrl = req.nextUrl.clone();
  loginUrl.pathname = "/login";
  loginUrl.search = `?next=${encodeURIComponent(pathname + (search || ""))}`;
  return NextResponse.redirect(loginUrl);
}

// Run middleware on everything EXCEPT Next's internal assets and the static
// public files that browsers fetch without cookies (CSS, JS bundles, fonts).
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|_next/data|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|webp|gif|ico|js|css|woff|woff2|ttf|map)$).*)",
  ],
};
