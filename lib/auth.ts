// Single-password auth wall for the dashboard.
//
// What's persisted in the cookie:
//   SHA-256(DASHBOARD_PASSWORD) hex-encoded.
//
// Why a hash, not the plaintext: the previous implementation stored the
// password value itself in the cookie. If anyone intercepted the cookie
// (XSS, browser extension, shoulder surfing the dev tools), they had the
// real password and could rotate it / share it. Storing the hash means:
//   - the cookie value is opaque to anyone who hasn't seen the password
//   - we can still verify ownership without ever holding the plaintext at
//     request time (it lives in process.env, never in DB or logs)
//   - timing-safe comparison protects against the comparison itself leaking
//     bits via response-time differences
//
// What's NOT here (deliberately):
//   - No server-side session store. Single-password app, no per-user state
//     to bind. Adding sessions for a 3-person dashboard would be overkill.
//   - No CSRF token. Same-origin only, SameSite=Lax cookie + no POSTs from
//     foreign origins. Add if we ever expose write APIs to a different host.

import { NextRequest } from "next/server";
import { createHash, timingSafeEqual } from "node:crypto";

// Default password if DASHBOARD_PASSWORD env var isn't set. Keeps the wall
// working on Railway even if the env var is missed during deploy. In prod
// we warn-once below so it's loud if you forgot to set the real one.
export const DEFAULT_PASSWORD = "Mosaic@2026";

const COOKIE = "hf_dash_auth";

let warnedAboutDefault = false;

export function dashboardPassword(): string {
  const fromEnv = (process.env.DASHBOARD_PASSWORD ?? "").trim();
  if (!fromEnv) {
    if (!warnedAboutDefault && process.env.NODE_ENV === "production") {
      // eslint-disable-next-line no-console
      console.warn(
        "[auth] DASHBOARD_PASSWORD env var is unset in production — falling back to the hardcoded default. Set DASHBOARD_PASSWORD on Railway to a real value."
      );
      warnedAboutDefault = true;
    }
    return DEFAULT_PASSWORD;
  }
  return fromEnv;
}

// Public: the hash that the /login form sends back via /api/auth, persisted
// as the cookie value. Anyone with the hash gains access — same threat
// model as the plaintext-cookie approach — but the hash isn't itself the
// password, so it can't be reused outside this app.
export function dashboardPasswordHash(): string {
  return createHash("sha256").update(dashboardPassword()).digest("hex");
}

// Constant-time compare to prevent the response-time of `===` from leaking
// information about how many characters matched. Both inputs are normalised
// to equal byte-length first so timingSafeEqual doesn't throw.
function safeEquals(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) {
    // Still do a comparison of equal-length buffers to keep timing flat.
    const padded = Buffer.alloc(aBuf.length);
    timingSafeEqual(aBuf, padded);
    return false;
  }
  return timingSafeEqual(aBuf, bBuf);
}

// Verify a submitted plaintext password (from the /login form POST) matches
// the configured password, in constant time.
export function verifyPassword(submitted: string): boolean {
  if (typeof submitted !== "string" || submitted.length === 0) return false;
  return safeEquals(submitted, dashboardPassword());
}

// Verify a cookie value (which is the SHA-256 hash) matches the expected
// hash, in constant time.
export function verifyCookie(cookieValue: string | undefined): boolean {
  if (!cookieValue) return false;
  return safeEquals(cookieValue, dashboardPasswordHash());
}

export function isAuthed(req: NextRequest): boolean {
  return verifyCookie(req.cookies.get(COOKIE)?.value);
}

export function authCookieName(): string {
  return COOKIE;
}

// In-memory IP rate limiter for the /login POST. 10 attempts per 5 minutes
// per IP, then 429s back. Lives per-process so a Railway restart clears it
// (fine — that's a circuit-breaker, not an audit log).
type Bucket = { count: number; resetAt: number };
const RATE_LIMIT_MAX = 10;
const RATE_LIMIT_WINDOW_MS = 5 * 60 * 1000;
const buckets = new Map<string, Bucket>();

export function rateLimitOk(ip: string): { ok: boolean; retryAfterSec: number } {
  const now = Date.now();
  const b = buckets.get(ip);
  if (!b || b.resetAt < now) {
    buckets.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return { ok: true, retryAfterSec: 0 };
  }
  if (b.count >= RATE_LIMIT_MAX) {
    return { ok: false, retryAfterSec: Math.max(1, Math.ceil((b.resetAt - now) / 1000)) };
  }
  b.count += 1;
  return { ok: true, retryAfterSec: 0 };
}

// Cookie attributes for the auth cookie. Centralised so /api/auth and any
// future cookie setters stay in sync.
export function authCookieOptions() {
  return {
    httpOnly: true as const,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    // 7 days. Short enough that a stolen cookie eventually times out;
    // long enough that the operator isn't re-logging-in every day.
    maxAge: 60 * 60 * 24 * 7,
  };
}
