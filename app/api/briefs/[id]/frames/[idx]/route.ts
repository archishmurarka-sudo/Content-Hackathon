import { NextRequest, NextResponse } from "next/server";
import { getBrief, setFrame } from "@/lib/briefs";
import { generateFrameImage } from "@/lib/images";
import { isAuthed } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

// POST /api/briefs/:id/frames/:idx
// body: { action: "regenerate" | "approve" | "unapprove", prompt_override?: string }
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; idx: string }> }
) {
  if (!isAuthed(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id, idx: idxStr } = await params;
  const idx = Number(idxStr);
  const body = await req.json().catch(() => ({}));
  const action = String(body.action ?? "regenerate");

  const brief = getBrief(id);
  if (!brief) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (!brief.storyboard) return NextResponse.json({ error: "storyboard not ready" }, { status: 400 });
  const shot = brief.storyboard.shots.find((s) => s.idx === idx);
  if (!shot) return NextResponse.json({ error: "shot not found" }, { status: 404 });

  if (action === "approve") {
    setFrame(id, idx, { status: "approved" });
    return NextResponse.json(getBrief(id));
  }
  if (action === "unapprove") {
    setFrame(id, idx, { status: "ready" });
    return NextResponse.json(getBrief(id));
  }

  // regenerate (default)
  const prompt = String(body.prompt_override ?? shot.image_prompt);
  setFrame(id, idx, { status: "pending", error: undefined, prompt });
  try {
    const img = await generateFrameImage({ prompt, brief_id: id, shot_idx: idx });
    setFrame(id, idx, { status: "ready", image_url: img.url, image_key: img.key, error: undefined });
  } catch (err: any) {
    setFrame(id, idx, { status: "failed", error: err?.message ?? "frame failed" });
  }
  return NextResponse.json(getBrief(id));
}
