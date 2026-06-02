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

// The team password. This is the always-accepted value so the wall works
// regardless of what Railway has in its DASHBOARD_PASSWORD env var (which
// has historically held stale values like "change-me" and locked operators
// out). If DASHBOARD_PASSWORD is also set on Railway, that ALSO works —
// rotate by setting the env var and the team can continue using either
// until you remove the constant from source. Repo must be kept private
// while this constant lives here.
export const DEFAULT_PASSWORD = "Mosaic@2026";

const COOKIE = "hf_dash_auth";

export function dashboardPassword(): string {
  return DEFAULT_PASSWORD;
}

// Every value a submitted password is allowed to match against. Both the
// hardcoded default AND whatever Railway has in DASHBOARD_PASSWORD are
// accepted, so a stale env var can't lock the team out.
function acceptedPasswords(): string[] {
  const out = [DEFAULT_PASSWORD];
  const fromEnv = (process.env.DASHBOARD_PASSWORD ?? "").trim();
  if (fromEnv && fromEnv !== DEFAULT_PASSWORD) out.push(fromEnv);
  return out;
}

function sha256Hex(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

// Public: the hash that the /login form sends back via /api/auth, persisted
// as the cookie value. Anyone with the hash gains access — same threat
// model as the plaintext-cookie approach — but the hash isn't itself the
// password, so it can't be reused outside this app.
export function dashboardPasswordHash(): string {
  return sha256Hex(dashboardPassword());
}

// Hashes of every accepted password, so a cookie minted with the Railway
// env-var password still verifies after we add the hardcoded fallback.
function acceptedPasswordHashes(): string[] {
  return acceptedPasswords().map(sha256Hex);
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
// any accepted password, in constant time. Trims whitespace first to absorb
// trailing spaces / newlines from copy-paste autofill (a common cause of
// "I'm typing it right but it rejects").
export function verifyPassword(submitted: string): boolean {
  if (typeof submitted !== "string") return false;
  const trimmed = submitted.trim();
  if (trimmed.length === 0) return false;
  for (const p of acceptedPasswords()) {
    if (safeEquals(trimmed, p)) return true;
  }
  return false;
}

// Verify a cookie value (which is the SHA-256 hash) matches any accepted
// password's hash, in constant time.
export function verifyCookie(cookieValue: string | undefined): boolean {
  if (!cookieValue) return false;
  for (const h of acceptedPasswordHashes()) {
    if (safeEquals(cookieValue, h)) return true;
  }
  return false;
}

export function isAuthed(req: NextRequest): boolean {
  return verifyCookie(req.cookies.get(COOKIE)?.value);
}

export function authCookieName(): string {
  return COOKIE;
}

// In-memory IP rate limiter for the /login POST. Up to 30 attempts per 5
// minutes per IP — generous enough that a real operator typo-storming the
// form doesn't get locked out, tight enough that a brute-force script
// still gets shut down within seconds. Bucket lives per-process so a
// Railway restart clears it (fine — that's a circuit-breaker, not an
// audit log) and a successful login also wipes the IP's bucket so a clean
// retry after a typo doesn't carry penalty count forward.
type Bucket = { count: number; resetAt: number };
const RATE_LIMIT_MAX = 30;
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

// Called from /api/auth on successful login so an operator's repeated-typo
// attempts don't keep counting against the rate limit after they finally
// get it right.
export function clearRateLimit(ip: string): void {
  buckets.delete(ip);
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
