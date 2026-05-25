// Single-password auth wall for the dashboard.
//
// Anything not in PUBLIC_PATHS requires the auth cookie set by /api/auth.
// Unauthenticated page requests get redirected to /login with ?next=<originalPath>.
// Unauthenticated API requests get a 401 JSON body so client fetches can react.
//
// IMPORTANT: This middleware runs on the Edge runtime by default and we
// keep it dependency-free so it stays edge-compatible. The cookie check
// here is a structural sniff (right length / shape only) — the real
// cryptographic verification happens in every API route + page handler via
// isAuthed() in lib/auth.ts (which uses node:crypto for timing-safe
// compare). Defense in layers: cheap edge gate first, then the strict
// node-runtime compare. Tampering with the cookie still gets you 401 from
// the handlers below.
//
// What stays PUBLIC and why:
//   /login                     — the password form itself
//   /api/auth                  — POST sets the cookie (otherwise no way in)
//   /api/health                — Railway / monitoring probes (returns minimal
//                                {ok:true} when unauthed; full env diag only
//                                if authed cookie present)
//   /api/assets/*              — videos & images linked from WhatsApp/email
//                                must be fetchable by browsers WITHOUT cookies
//   /handoff/*                 — creator-facing share page; URL sent over WA
//   /pitch.html, /creator-ranking.png, /favicon.ico — static, shareable

import { NextRequest, NextResponse } from "next/server";

const COOKIE = "hf_dash_auth";

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

  // Presence-only check at the edge — the actual cryptographic comparison
  // runs in the Node-runtime handlers (isAuthed() in lib/auth.ts). Missing
  // or wrong-shaped cookie means definitely-not-authed, so we redirect
  // right away. A forged cookie of the right shape still fails the strict
  // compare in the handler.
  const cookie = req.cookies.get(COOKIE)?.value;
  if (cookie && /^[0-9a-f]{64}$/.test(cookie)) {
    // 64 hex chars = SHA-256 output shape. Pass through; handler verifies.
    return NextResponse.next();
  }

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
