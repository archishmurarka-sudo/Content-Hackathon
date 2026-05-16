import { NextRequest } from "next/server";

// Auth is intentionally disabled for the trial/demo. Re-enable later by
// reverting to the password-cookie check.
export function isAuthed(_req: NextRequest): boolean {
  return true;
}

export function authCookieName() {
  return "hf_dash_auth";
}
