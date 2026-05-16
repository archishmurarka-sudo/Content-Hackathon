import { NextRequest, NextResponse } from "next/server";
import { getCreators, findCreator } from "@/lib/data";
import { isAuthed } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!isAuthed(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const q = req.nextUrl.searchParams.get("q")?.trim().toLowerCase();
  const handle = req.nextUrl.searchParams.get("handle");
  if (handle) {
    const c = findCreator(handle);
    if (!c) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json(c);
  }
  let list = getCreators();
  if (q) list = list.filter((c) => c.handle.toLowerCase().includes(q) || c.archetype.toLowerCase().includes(q));
  return NextResponse.json({ creators: list.slice(0, 50) });
}
