import { NextRequest } from "next/server";

// Default password if DASHBOARD_PASSWORD env var isn't set. Keeps the wall
// working on Railway even if the env var is missed during deploy.
export const DEFAULT_PASSWORD = "Mosaic@2026";

export function dashboardPassword(): string {
  return process.env.DASHBOARD_PASSWORD || DEFAULT_PASSWORD;
}

const COOKIE = "hf_dash_auth";

export function isAuthed(req: NextRequest): boolean {
  return req.cookies.get(COOKIE)?.value === dashboardPassword();
}

export function authCookieName() {
  return COOKIE;
}
