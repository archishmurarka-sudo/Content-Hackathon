import { NextRequest, NextResponse } from "next/server";
import { getBrief, setDelivery } from "@/lib/briefs";
import { sendWhatsAppVideos, getCreatorPhone, setCreatorPhone } from "@/lib/delivery";
import { isAuthed } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

// POST /api/briefs/:id/deliver
// Body: { phone?: string, save_phone?: boolean }
// Sends every ready shot clip to the creator via Periskope WhatsApp.
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

  const ready = brief.frames
    .filter((f) => f.video_status === "ready" && f.video_url)
    .sort((a, b) => a.shot_idx - b.shot_idx);
  if (ready.length === 0) {
    return NextResponse.json({ error: "no rendered video clips to send" }, { status: 400 });
  }

  const origin = absoluteOrigin(req);
  const mediaUrls = ready.map((f) => absolutize(origin, f.video_url!));

  const caption = buildCaption(brief, origin);

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

function buildCaption(brief: any, origin: string): string {
  const hook = brief.storyboard?.hook ? `“${brief.storyboard.hook}”\n\n` : "";
  return `${hook}New short for @${brief.creator_handle} — ${brief.storyboard?.shots?.length ?? brief.frames.length} shots, ${brief.target_duration_s}s. Full brief: ${origin}/briefs/${brief.id}`;
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
