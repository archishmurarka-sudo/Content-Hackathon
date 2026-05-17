import { NextRequest, NextResponse } from "next/server";
import { authCookieName, dashboardPassword } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const expected = dashboardPassword();
  const body = await req.json().catch(() => ({}));
  if (body.password !== expected) {
    return NextResponse.json({ ok: false, error: "wrong password" }, { status: 401 });
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set(authCookieName(), expected, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  return res;
}

// DELETE /api/auth → log out (clear cookie). Used by the sidebar "Log out" link.
export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(authCookieName(), "", { path: "/", maxAge: 0 });
  return res;
}
