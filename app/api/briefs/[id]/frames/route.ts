import { NextRequest, NextResponse } from "next/server";
import { getBrief, initFrames, setFrame } from "@/lib/briefs";
import { generateFrameImage } from "@/lib/images";
import { isAuthed } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300; // up to 5 minutes for the whole batch

// POST /api/briefs/:id/frames  → generate (or re-generate) ALL frames for the brief.
// Runs in parallel; each frame is saved/updated as it completes.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!isAuthed(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const brief = getBrief(id);
  if (!brief) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (!brief.storyboard) return NextResponse.json({ error: "storyboard not ready" }, { status: 400 });

  initFrames(id);

  await Promise.all(
    brief.storyboard.shots.map(async (shot) => {
      try {
        const img = await generateFrameImage({
          prompt: shot.image_prompt,
          brief_id: id,
          shot_idx: shot.idx,
        });
        setFrame(id, shot.idx, { status: "ready", image_url: img.url, image_key: img.key, error: undefined });
      } catch (err: any) {
        setFrame(id, shot.idx, { status: "failed", error: err?.message ?? "frame failed" });
      }
    })
  );

  return NextResponse.json(getBrief(id));
}
