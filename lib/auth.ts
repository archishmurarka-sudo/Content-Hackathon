import { NextRequest } from "next/server";

// Single fixed password for the team. Hardcoded on purpose so the wall
// works regardless of what (if anything) Railway's DASHBOARD_PASSWORD
// env var is set to — the env var is ignored.
const PASSWORD = "Mosaic@2026";

export function dashboardPassword(): string {
  return PASSWORD;
}

const COOKIE = "hf_dash_auth";

export function isAuthed(req: NextRequest): boolean {
  return req.cookies.get(COOKIE)?.value === PASSWORD;
}

export function authCookieName() {
  return COOKIE;
}
