import { NextResponse } from "next/server";
import { authCookieName } from "@/lib/auth";

export const runtime = "nodejs";

// Password gate removed. Endpoints are no-ops kept around so any
// lingering client-side login form / logout link still resolves cleanly.

export async function POST() {
  return NextResponse.json({ ok: true });
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(authCookieName(), "", { path: "/", maxAge: 0 });
  return res;
}
