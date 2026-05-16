import { NextRequest, NextResponse } from "next/server";
import { getBrief, setFrame } from "@/lib/briefs";
import { generateFrameImage } from "@/lib/images";
import { findCreator, PRODUCTS } from "@/lib/data";
import { isAuthed } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

// POST /api/briefs/:id/frames/:idx
// body: {
//   action: "regenerate" | "approve" | "unapprove",
//   prompt_override?: string,   // full replacement of the per-shot image prompt
//   feedback?: string           // one-shot user note: "make it brighter", "hand from right side"
// }
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; idx: string }> }
) {
  if (!isAuthed(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id, idx: idxStr } = await params;
  const idx = Number(idxStr);
  const body = await req.json().catch(() => ({}));
  const action = String(body.action ?? "regenerate");

  const brief = await getBrief(id);
  if (!brief) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (!brief.storyboard) return NextResponse.json({ error: "storyboard not ready" }, { status: 400 });
  const shot = brief.storyboard.shots.find((s) => s.idx === idx);
  if (!shot) return NextResponse.json({ error: "shot not found" }, { status: 404 });

  if (action === "approve") {
    await setFrame(id, idx, { status: "approved" });
    return NextResponse.json(await getBrief(id));
  }
  if (action === "unapprove") {
    await setFrame(id, idx, { status: "ready" });
    return NextResponse.json(await getBrief(id));
  }

  // regenerate (default)
  const promptText = typeof body.prompt_override === "string" && body.prompt_override.trim()
    ? body.prompt_override.trim()
    : shot.image_prompt;
  const feedback = typeof body.feedback === "string" && body.feedback.trim()
    ? body.feedback.trim()
    : undefined;

  await setFrame(id, idx, { status: "pending", error: undefined, prompt: promptText });

  const creator = findCreator(brief.creator_handle);
  const product = PRODUCTS.find((p) => p.id === brief.product_id);
  const productLabel = product ? `${product.name} (${product.brand})` : undefined;

  try {
    const img = await generateFrameImage({
      prompt: promptText,
      brief_id: id,
      shot_idx: idx,
      product_label: productLabel,
      creator_handle: brief.creator_handle,
      creator_archetype: creator?.archetype,
      shot_visual: shot.visual,
      shot_product_action: shot.product_action,
      shot_overlay: shot.overlay,
      feedback,
    });
    await setFrame(id, idx, { status: "ready", image_url: img.url, image_key: img.key, error: undefined });
  } catch (err: any) {
    await setFrame(id, idx, { status: "failed", error: err?.message ?? "frame failed" });
  }
  return NextResponse.json(await getBrief(id));
}
