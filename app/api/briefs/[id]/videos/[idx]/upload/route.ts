// POST /api/briefs/:id/videos/:idx/upload  (multipart/form-data, field "file")
//
// Operator override — upload an mp4 / webm / mov to use as the rendered clip
// for this shot instead of calling Veo. No UI button surfaces this on purpose;
// it's a CLI / scripted tool for demos + manual re-shoots. Run via
// scripts/force-fill-clips.mjs.

import { NextRequest, NextResponse } from "next/server";
import { getBrief, setFrame } from "@/lib/briefs";
import { putAsset } from "@/lib/storage";
import { logEvent } from "@/lib/events";
import { isAuthed } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const MAX_BYTES = 100 * 1024 * 1024; // 100 MB cap — generous for an 8s 1080p clip

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; idx: string }> }
) {
  if (!isAuthed(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id, idx: idxStr } = await params;
  const shotIdx = Number(idxStr);
  if (Number.isNaN(shotIdx)) return NextResponse.json({ error: "bad shot index" }, { status: 400 });

  const brief = await getBrief(id);
  if (!brief?.frames || !brief.storyboard) return NextResponse.json({ error: "not ready" }, { status: 400 });
  const frame = brief.frames.find((f) => f.shot_idx === shotIdx);
  if (!frame) return NextResponse.json({ error: "shot not found" }, { status: 404 });

  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "expected multipart/form-data" }, { status: 400 });
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "field 'file' required" }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: `file too large (max ${MAX_BYTES / 1024 / 1024} MB)` }, { status: 413 });

  const mime = file.type || "video/mp4";
  if (!mime.startsWith("video/")) return NextResponse.json({ error: "only video/* mime types accepted" }, { status: 400 });

  const ext = mime.includes("webm") ? "webm" : (mime.includes("quicktime") || mime.includes("mov")) ? "mov" : "mp4";

  const buf = Buffer.from(await file.arrayBuffer());
  const stored = await putAsset({
    prefix: `briefs/${id}/videos/shot_${shotIdx}/upload`,
    ext,
    body: buf,
    contentType: mime,
  });

  await setFrame(id, shotIdx, {
    video_status: "ready",
    video_url: stored.url,
    video_key: stored.key,
    video_model: "operator-upload",
    video_error: undefined,
  });

  void logEvent({
    type: "video.uploaded",
    brief_id: id,
    shot_idx: shotIdx,
    payload: {
      filename: file.name,
      content_type: mime,
      size_bytes: buf.length,
      creator_handle: brief.creator_handle,
      product_id: brief.product_id,
    },
    outcome: { video_url: stored.url, video_key: stored.key },
  });

  return NextResponse.json({ ok: true, shot_idx: shotIdx, video_url: stored.url });
}
