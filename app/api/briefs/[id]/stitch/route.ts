// POST /api/briefs/:id/stitch
//
// Concats all rendered shot clips (video_status === "ready" with a video_url)
// into a single final mp4, burns the storyboard overlay text onto each segment,
// stores in R2, and stamps final_video_url on the brief.

import { NextRequest, NextResponse } from "next/server";
import { getBrief, setFinalVideo } from "@/lib/briefs";
import { stitchFinalVideo } from "@/lib/stitch";
import { isAuthed } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!isAuthed(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const brief = await getBrief(id);
  if (!brief) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (!brief.storyboard) return NextResponse.json({ error: "no storyboard" }, { status: 400 });
  const frames = brief.frames ?? [];
  const ready = frames.filter((f) => f.video_status === "ready" && f.video_url);
  if (ready.length === 0)
    return NextResponse.json({ error: "no rendered clips to stitch" }, { status: 400 });

  try {
    const stitched = await stitchFinalVideo({
      brief_id: id,
      clips: ready.map((f) => ({
        shot_idx: f.shot_idx,
        video_url: f.video_url!,
        overlay: brief.storyboard!.shots.find((s) => s.idx === f.shot_idx)?.overlay,
      })),
    });
    await setFinalVideo(id, stitched.url, stitched.key);
    return NextResponse.json(await getBrief(id));
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? "stitch failed" }, { status: 500 });
  }
}
