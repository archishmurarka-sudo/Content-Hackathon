import { NextRequest, NextResponse } from "next/server";
import { getBrief } from "@/lib/briefs";
import { isAuthed } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!isAuthed(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const brief = getBrief(id);
  if (!brief) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(brief);
}
