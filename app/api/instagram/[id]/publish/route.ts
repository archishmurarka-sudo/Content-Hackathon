// Mark an IG post as published. Stamps a timestamp on the row so the
// gallery can show a "Published ✓" badge. No actual Meta Graph API call
// yet — that integration is gated on an IG business account + app
// approval + page tokens, which we'll wire when the brand handle is
// ready. Until then this is the "this went live, here's when" log.

import { NextRequest, NextResponse } from "next/server";
import { isAuthed } from "@/lib/auth";
import { publishIgPost } from "@/lib/instagram";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!isAuthed(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  try {
    const post = await publishIgPost(id);
    if (!post) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json(post);
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? "publish failed" }, { status: 400 });
  }
}
