import { NextRequest, NextResponse } from "next/server";
import { purgeFailed } from "@/lib/briefs";
import { isAuthed } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  if (!isAuthed(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const n = purgeFailed();
  return NextResponse.json({ purged: n });
}
