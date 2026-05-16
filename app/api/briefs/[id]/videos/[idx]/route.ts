import { NextRequest, NextResponse } from "next/server";
import { getBrief, setFrame } from "@/lib/briefs";
import { renderShotVideoAndStore } from "@/lib/video";
import { logEvent } from "@/lib/events";
import { isAuthed } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 540;

// POST /api/briefs/:id/videos/:idx
// Re-render a single shot's clip (used by the per-shot "Regenerate video" button).
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string; idx: string }> }) {
  if (!isAuthed(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id, idx } = await params;
  const shotIdx = Number(idx);
  if (Number.isNaN(shotIdx)) return NextResponse.json({ error: "bad shot index" }, { status: 400 });

  const brief = await getBrief(id);
  if (!brief?.frames || !brief.storyboard) return NextResponse.json({ error: "not ready" }, { status: 400 });
  const frame = brief.frames.find((f) => f.shot_idx === shotIdx);
  const shot = brief.storyboard.shots.find((s) => s.idx === shotIdx);
  if (!frame || !shot) return NextResponse.json({ error: "shot not found" }, { status: 404 });
  if (!frame.image_url) return NextResponse.json({ error: "frame image missing" }, { status: 400 });

  await setFrame(id, shotIdx, { video_status: "pending", video_error: undefined });
  void logEvent({
    type: "video.render_started",
    brief_id: id,
    shot_idx: shotIdx,
    payload: {
      frame_image_url: frame.image_url,
      video_prompt: shot.video_prompt,
      visual: shot.visual,
    },
  });

  const origin = absoluteOrigin(req);
  const startedAt = Date.now();

  try {
    const video = await renderShotVideoAndStore({
      brief_id: id,
      shot_idx: shotIdx,
      image_url: absolutize(origin, frame.image_url),
      prompt: shot.video_prompt || shot.visual || "",
      duration_s: shot.duration_s,
      aspect_ratio: "9:16",
    });
    await setFrame(id, shotIdx, {
      video_status: "ready",
      video_url: video.url,
      video_key: video.key,
      video_model: video.model,
      video_error: undefined,
    });
    void logEvent({
      type: "video.render_completed",
      brief_id: id,
      shot_idx: shotIdx,
      payload: {
        frame_image_url: frame.image_url,
        video_prompt: shot.video_prompt,
        model: video.model,
      },
      outcome: {
        video_url: video.url,
        duration_s: video.duration_s,
        latency_ms: Date.now() - startedAt,
      },
    });
  } catch (err: any) {
    await setFrame(id, shotIdx, {
      video_status: "failed",
      video_error: err?.message ?? "video render failed",
    });
    void logEvent({
      type: "video.render_failed",
      brief_id: id,
      shot_idx: shotIdx,
      payload: { video_prompt: shot.video_prompt },
      outcome: { error: err?.message ?? "video render failed", latency_ms: Date.now() - startedAt },
    });
  }

  return NextResponse.json(await getBrief(id));
}

function absoluteOrigin(req: NextRequest): string {
  const proto = req.headers.get("x-forwarded-proto") ?? "https";
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "localhost:3000";
  return `${proto}://${host}`;
}

function absolutize(origin: string, urlOrPath: string): string {
  if (/^https?:\/\//i.test(urlOrPath)) return urlOrPath;
  return `${origin}${urlOrPath.startsWith("/") ? "" : "/"}${urlOrPath}`;
}
