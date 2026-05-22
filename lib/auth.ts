import { NextRequest } from "next/server";

// Password sourced from DASHBOARD_PASSWORD env var. If unset locally, a
// hardcoded dev fallback keeps the wall working — production must set
// the env var explicitly. Trim to forgive stray whitespace from copy-paste.
const FALLBACK_PASSWORD = "Mosaic@2026";
function getPassword(): string {
  return (process.env.DASHBOARD_PASSWORD ?? FALLBACK_PASSWORD).trim();
}

export function dashboardPassword(): string {
  return getPassword();
}

const COOKIE = "hf_dash_auth";

export function isAuthed(req: NextRequest): boolean {
  return req.cookies.get(COOKIE)?.value === getPassword();
}

export function authCookieName() {
  return COOKIE;
}
