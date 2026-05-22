import { NextRequest } from "next/server";

// Password gate disabled — dashboard is open. Helpers kept as no-ops so
// existing imports across API routes continue to compile without churn.

const COOKIE = "hf_dash_auth";

export function dashboardPassword(): string {
  return "";
}

export function isAuthed(_req: NextRequest): boolean {
  return true;
}

export function authCookieName() {
  return COOKIE;
}
