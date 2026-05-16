import { NextRequest, NextResponse } from "next/server";
import { getBrief, setDelivery } from "@/lib/briefs";
import {
  sendCreatorHandoff,
  sendCreatorPreview,
  sendWhatsAppVideos,
  getCreatorPhone,
  setCreatorPhone,
} from "@/lib/delivery";
import { logEvent } from "@/lib/events";
import { isAuthed } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

// POST /api/briefs/:id/deliver
// Body: { phone?: string, save_phone?: boolean, mode?: "handoff" | "shots" }
//
// Default (mode="handoff"): one WhatsApp message containing the stitched
// final video + a link to /handoff/<id>. Falls back to mode="shots" if no
// stitched mp4 is available — that path sends each shot as its own clip.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!isAuthed(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const brief = await getBrief(id);
  if (!brief) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (!brief.frames) return NextResponse.json({ error: "no frames" }, { status: 400 });

  const body = await req.json().catch(() => ({} as any));
  const phone = String(body.phone ?? "").trim() || getCreatorPhone(brief.creator_handle);
  if (!phone) return NextResponse.json({ error: "no phone number for this creator — pass {phone} or save one first" }, { status: 400 });
  if (body.save_phone && body.phone) setCreatorPhone(brief.creator_handle, body.phone);

  const origin = process.env.PUBLIC_BASE_URL?.replace(/\/$/, "") || absoluteOrigin(req);
  const requestedMode: "handoff" | "shots" = body.mode === "shots" ? "shots" : "handoff";

  const finalUrl = brief.final_video_url
    ? absolutize(origin, brief.final_video_url)
    : null;

  // Prefer the single stitched handoff if it exists; otherwise fall back to
  // per-shot sends so the operator can still deliver a partial brief.
  if (requestedMode === "handoff" && finalUrl) {
    const handoff_url = `${origin}/handoff/${brief.id}`;
    const captionLead = brief.storyboard?.hook ? `"${brief.storyboard.hook}"` : "";
    const filename = `${brief.creator_handle}-${brief.product_id}-${brief.target_duration_s}s.mp4`;
    try {
      const res = await sendCreatorHandoff({
        to: phone,
        video_url: finalUrl,
        filename,
        handoff_url,
        caption_lead: captionLead,
      });
      await setDelivery(id, {
        status: "sent",
        channel: "whatsapp",
        to: res.to,
        message_id: res.message_id,
        sent_at: Date.now(),
      });
      return NextResponse.json({ ...(await getBrief(id)), handoff_url });
    } catch (err: any) {
      await setDelivery(id, {
        status: "failed",
        channel: "whatsapp",
        to: phone,
        error: err?.message ?? "send failed",
      });
      return NextResponse.json({ error: err?.message ?? "send failed" }, { status: 502 });
    }
  }

  // Fallback chain: per-shot video clips → first frame image preview.
  // This lets the operator deliver a "what's been built so far" preview
  // even when the OpenRouter / fal render hasn't run yet.
  const readyVideos = brief.frames
    .filter((f) => f.video_status === "ready" && f.video_url)
    .sort((a, b) => a.shot_idx - b.shot_idx);

  if (readyVideos.length === 0) {
    // Frame-image preview path
    const readyFrames = brief.frames
      .filter((f) => f.status === "ready" && f.image_url)
      .sort((a, b) => a.shot_idx - b.shot_idx);
    if (readyFrames.length === 0) {
      return NextResponse.json({ error: "no frames or videos ready to send" }, { status: 400 });
    }
    const lead = readyFrames[0];
    const handoff_url = `${origin}/handoff/${brief.id}`;
    const meta = `${brief.storyboard?.shots?.length ?? brief.frames.length} shots · ${brief.target_duration_s}s · ${funnelLabel(brief)}`;
    const captionLead = brief.storyboard?.hook ?? `Your @${brief.creator_handle} brief`;
    try {
      const res = await sendCreatorPreview({
        to: phone,
        image_url: absolutize(origin, lead.image_url!),
        filename: `${brief.creator_handle}-${brief.product_id}-shot1.png`,
        handoff_url,
        caption_lead: captionLead,
        meta,
        cta: brief.storyboard?.cta,
      });
      await setDelivery(id, {
        status: "sent",
        channel: "whatsapp",
        to: res.to,
        message_id: res.message_id,
        sent_at: Date.now(),
      });
      return NextResponse.json({ ...(await getBrief(id)), handoff_url });
    } catch (err: any) {
      await setDelivery(id, {
        status: "failed",
        channel: "whatsapp",
        to: phone,
        error: err?.message ?? "send failed",
      });
      return NextResponse.json({ error: err?.message ?? "send failed" }, { status: 502 });
    }
  }

  const mediaUrls = readyVideos.map((f) => absolutize(origin, f.video_url!));
  const caption = buildShotCaption(brief, origin);
  try {
    const res = await sendWhatsAppVideos({ to: phone, media_urls: mediaUrls, caption });
    await setDelivery(id, {
      status: "sent",
      channel: "whatsapp",
      to: res.to,
      message_id: res.message_id,
      sent_at: Date.now(),
    });
    return NextResponse.json(await getBrief(id));
  } catch (err: any) {
    await setDelivery(id, {
      status: "failed",
      channel: "whatsapp",
      to: phone,
      error: err?.message ?? "send failed",
    });
    return NextResponse.json({ error: err?.message ?? "send failed" }, { status: 502 });
  }
}

function buildShotCaption(brief: any, origin: string): string {
  const hook = brief.storyboard?.hook ? `"${brief.storyboard.hook}"\n\n` : "";
  return `${hook}New short for @${brief.creator_handle} — ${brief.storyboard?.shots?.length ?? brief.frames.length} shots, ${brief.target_duration_s}s. Full brief: ${origin}/handoff/${brief.id}`;
}

function funnelLabel(brief: any): string {
  // The storyboard CTA hints at the funnel stage. Cheap heuristic, used for
  // the WhatsApp caption metadata.
  const cta = (brief.storyboard?.cta ?? "").toLowerCase();
  if (/(\bbuy\b|cart|deal|sale|today|tonight)/.test(cta)) return "Bottom-of-funnel";
  if (/(link in bio|see why|learn|why i)/.test(cta)) return "Middle-of-funnel";
  return "Top-of-funnel";
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
