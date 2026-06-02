// POST   /api/auth   → verify password, set hashed auth cookie
// DELETE /api/auth   → log out (clear cookie)
//
// Password is never stored in the cookie — we set the SHA-256 hash. The
// compare is timing-safe. Brute-force attempts are rate-limited per IP
// (10 / 5 min) so a script can't pound the form.

import { NextRequest, NextResponse } from "next/server";
import {
  authCookieName,
  authCookieOptions,
  clearRateLimit,
  dashboardPasswordHash,
  rateLimitOk,
  verifyPassword,
} from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function clientIp(req: NextRequest): string {
  // Prefer x-real-ip (Railway/most CDNs set this to the actual remote
  // client). Fall back to the RIGHT-most x-forwarded-for entry — that's
  // the one set by your trusted proxy. Reading the LEFT-most XFF (as the
  // old code did) lets an attacker spoof their own rate-limit bucket
  // simply by sending a fake XFF header.
  const real = req.headers.get("x-real-ip");
  if (real && real.trim()) return real.trim();
  const fwd = req.headers.get("x-forwarded-for") ?? "";
  const hops = fwd.split(",").map((h) => h.trim()).filter(Boolean);
  if (hops.length > 0) return hops[hops.length - 1];
  return "unknown";
}

export async function POST(req: NextRequest) {
  const ip = clientIp(req);
  const rl = rateLimitOk(ip);
  if (!rl.ok) {
    return NextResponse.json(
      { ok: false, error: `too many attempts — retry in ${rl.retryAfterSec}s` },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } },
    );
  }

  const body = await req.json().catch(() => ({} as any));
  const submitted = typeof body?.password === "string" ? body.password : "";
  if (!verifyPassword(submitted)) {
    // Log without leaking the attempted password. Useful for spotting
    // brute-force patterns in Railway logs.
    // eslint-disable-next-line no-console
    console.warn(`[auth] failed login from ${ip}`);
    return NextResponse.json({ ok: false, error: "wrong password" }, { status: 401 });
  }

  // Clear the IP's rate-limit bucket — operator probably typo'd before
  // landing on the right password; no reason to carry penalty count forward.
  clearRateLimit(ip);

  const res = NextResponse.json({ ok: true });
  res.cookies.set(authCookieName(), dashboardPasswordHash(), authCookieOptions());
  return res;
}

// DELETE /api/auth → log out (clear cookie).
export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  // Match the original cookie's path so the browser actually deletes it.
  res.cookies.set(authCookieName(), "", { ...authCookieOptions(), maxAge: 0 });
  return res;
}
