import { NextRequest, NextResponse } from "next/server";
import { listJobs } from "@/lib/jobs";
import { isAuthed } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!isAuthed(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json({ jobs: listJobs() });
}
