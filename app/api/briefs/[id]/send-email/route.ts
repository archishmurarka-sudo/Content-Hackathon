// POST /api/briefs/:id/send-email
// body: { to: string, posting_notes?: string }
//
// Sends the stitched final video link to a creator via Resend. Stamps the
// brief's `delivery` field with channel="email" and status="sent" (or "failed").

import { NextRequest, NextResponse } from "next/server";
import { getBrief, setDelivery } from "@/lib/briefs";
import { sendDeliveryEmail } from "@/lib/email";
import { PRODUCTS } from "@/lib/data";
import { isAuthed } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!isAuthed(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const to = String(body.to ?? "").trim();
  const posting_notes = typeof body.posting_notes === "string" ? body.posting_notes.trim() : undefined;
  if (!to || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to))
    return NextResponse.json({ error: "valid 'to' email required" }, { status: 400 });

  if (!process.env.RESEND_API_KEY)
    return NextResponse.json({ error: "RESEND_API_KEY not set on the server" }, { status: 500 });

  const brief = await getBrief(id);
  if (!brief) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (!brief.storyboard) return NextResponse.json({ error: "no storyboard" }, { status: 400 });
  if (!brief.final_video_url) return NextResponse.json({ error: "no final video yet — run stitch first" }, { status: 400 });

  const product = PRODUCTS.find((p) => p.id === brief.product_id);
  const productName = product?.name ?? brief.product_id;

  await setDelivery(id, {
    status: "queued",
    channel: "email",
    to,
  });

  try {
    // Email links need an absolute URL. Final video is stored at /api/assets/...
    // We resolve to the public Railway URL.
    const base = absoluteOrigin(req);
    const absVideoUrl = brief.final_video_url.startsWith("http")
      ? brief.final_video_url
      : `${base.replace(/\/$/, "")}${brief.final_video_url.startsWith("/") ? "" : "/"}${brief.final_video_url}`;

    const result = await sendDeliveryEmail({
      to,
      creator_handle: brief.creator_handle,
      product_name: productName,
      hook: brief.storyboard.hook ?? "",
      cta: brief.storyboard.cta ?? "",
      video_url: absVideoUrl,
      posting_notes,
    });
    await setDelivery(id, {
      status: "sent",
      channel: "email",
      to,
      message_id: result.id,
      sent_at: Date.now(),
      subject: `New video drop for @${brief.creator_handle} — ${productName}`,
    });
    return NextResponse.json(await getBrief(id));
  } catch (err: any) {
    await setDelivery(id, {
      status: "failed",
      channel: "email",
      to,
      error: err?.message ?? "send failed",
    });
    return NextResponse.json({ error: err?.message ?? "send failed" }, { status: 500 });
  }
}

function absoluteOrigin(req: NextRequest): string {
  const env = process.env.PUBLIC_BASE_URL ?? process.env.RAILWAY_PUBLIC_DOMAIN;
  if (env) return env.startsWith("http") ? env : `https://${env}`;
  const u = new URL(req.url);
  return `${u.protocol}//${u.host}`;
}
