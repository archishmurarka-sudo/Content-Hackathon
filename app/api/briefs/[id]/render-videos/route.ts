// POST /api/briefs/:id/render-videos
//
// Kicks off OpenRouter → Veo 3.1 Lite image-to-video render for every approved
// frame in parallel.
// Each shot's clip URL is stored on the frame (video_url, video_status), and
// the brief status rolls up to "videos_pending" → "videos_ready" automatically.
//
// Long-running: maxDuration 300s. Each render usually finishes in 30-90s.

import { NextRequest, NextResponse } from "next/server";
import { getBrief, setFrame } from "@/lib/briefs";
import { renderShotVideoAndStore } from "@/lib/video";
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
  if (!brief.frames || brief.frames.length === 0)
    return NextResponse.json({ error: "no frames" }, { status: 400 });
  if (!process.env.OPENROUTER_API_KEY)
    return NextResponse.json({ error: "OPENROUTER_API_KEY not set on the server" }, { status: 500 });

  // Render only approved frames (so users explicitly gate which shots become video).
  const approved = brief.frames.filter((f) => f.status === "approved" && f.image_url);
  if (approved.length === 0)
    return NextResponse.json({ error: "no approved frames to render" }, { status: 400 });

  // Mark each as pending up-front so the UI shows progress immediately.
  await Promise.all(
    approved.map((f) => setFrame(id, f.shot_idx, { video_status: "pending", video_error: undefined }))
  );

  // Render all in parallel. Per-frame failure is isolated.
  const baseHost = absoluteOrigin(req);
  await Promise.all(
    approved.map(async (f) => {
      const shot = brief.storyboard!.shots.find((s) => s.idx === f.shot_idx);
      if (!shot) return;
      try {
        const result = await renderShotVideoAndStore({
          brief_id: id,
          shot_idx: f.shot_idx,
          // fal needs an absolute URL it can fetch from the internet.
          image_url: absolutize(f.image_url!, baseHost),
          prompt: shot.video_prompt || shot.visual || shot.image_prompt,
          duration_s: shot.duration_s,
          aspect_ratio: "9:16",
        });
        await setFrame(id, f.shot_idx, {
          video_status: "ready",
          video_url: result.url,
          video_key: result.key,
          video_model: result.model,
          video_error: undefined,
        });
      } catch (err: any) {
        await setFrame(id, f.shot_idx, {
          video_status: "failed",
          video_error: err?.message ?? "render failed",
        });
      }
    })
  );

  return NextResponse.json(await getBrief(id));
}

function absoluteOrigin(req: NextRequest): string {
  const env = process.env.PUBLIC_BASE_URL ?? process.env.RAILWAY_PUBLIC_DOMAIN;
  if (env) return env.startsWith("http") ? env : `https://${env}`;
  const u = new URL(req.url);
  return `${u.protocol}//${u.host}`;
}

function absolutize(url: string, base: string): string {
  if (/^https?:\/\//i.test(url)) return url;
  return `${base.replace(/\/$/, "")}${url.startsWith("/") ? "" : "/"}${url}`;
}
