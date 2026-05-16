import { NextRequest } from "next/server";

const COOKIE = "hf_dash_auth";

export function isAuthed(req: NextRequest): boolean {
  const expected = process.env.DASHBOARD_PASSWORD;
  if (!expected) return true; // auth disabled
  return req.cookies.get(COOKIE)?.value === expected;
}

export function authCookieName() {
  return COOKIE;
}
