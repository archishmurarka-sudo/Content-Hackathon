import { NextRequest, NextResponse } from "next/server";
import { getUsage } from "@/lib/usage";
import { isAuthed } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!isAuthed(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json(getUsage());
}
