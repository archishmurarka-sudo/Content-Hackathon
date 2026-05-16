import { NextRequest, NextResponse } from "next/server";
import { getBrief, setFrame } from "@/lib/briefs";
import { generateFrameImage } from "@/lib/images";
import { findCreator, findProduct, ensureCreatorsLoaded, ensureProductsLoaded } from "@/lib/data";
import { logEvent } from "@/lib/events";
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
    void logEvent({
      type: "frame.approved",
      brief_id: id,
      shot_idx: idx,
      payload: {
        approved_prompt: shot.image_prompt,
        approved_image_url: brief.frames?.find((f) => f.shot_idx === idx)?.image_url,
      },
    });
    return NextResponse.json(await getBrief(id));
  }
  if (action === "unapprove") {
    await setFrame(id, idx, { status: "ready" });
    void logEvent({
      type: "frame.unapproved",
      brief_id: id,
      shot_idx: idx,
      payload: { reverted_prompt: shot.image_prompt },
    });
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

  await ensureCreatorsLoaded();
  await ensureProductsLoaded();
  const creator = findCreator(brief.creator_handle);
  const product = findProduct(brief.product_id);
  const productLabel = product ? `${product.name} (${product.brand})` : undefined;
  const productHero = product?.hero_image_url ?? undefined;

  // Snapshot the pre-regen state so we can log a clean (before, after) pair
  // for training: original prompt + the image it produced, then the new prompt
  // + the new image (and the user's feedback that drove the change).
  const previousImageUrl = brief.frames?.find((f) => f.shot_idx === idx)?.image_url;
  const startedAt = Date.now();

  try {
    const img = await generateFrameImage({
      prompt: promptText,
      brief_id: id,
      shot_idx: idx,
      product_label: productLabel,
      product_hero_url: productHero,
      creator_handle: brief.creator_handle,
      creator_archetype: creator?.archetype,
      shot_visual: shot.visual,
      shot_product_action: shot.product_action,
      shot_overlay: shot.overlay,
      feedback,
    });
    await setFrame(id, idx, { status: "ready", image_url: img.url, image_key: img.key, error: undefined });
    void logEvent({
      type: "frame.regenerated",
      brief_id: id,
      shot_idx: idx,
      payload: {
        original_prompt: shot.image_prompt,
        prompt_override: body.prompt_override ?? null,
        prompt_used: promptText,
        feedback: feedback ?? null,
        creator_handle: brief.creator_handle,
        creator_archetype: creator?.archetype ?? null,
        product_id: brief.product_id,
        product_hero_url: productHero ?? null,
        previous_image_url: previousImageUrl ?? null,
      },
      outcome: {
        new_image_url: img.url,
        new_image_key: img.key,
        latency_ms: Date.now() - startedAt,
      },
    });
  } catch (err: any) {
    await setFrame(id, idx, { status: "failed", error: err?.message ?? "frame failed" });
    void logEvent({
      type: "frame.regenerated",
      brief_id: id,
      shot_idx: idx,
      payload: {
        original_prompt: shot.image_prompt,
        prompt_override: body.prompt_override ?? null,
        prompt_used: promptText,
        feedback: feedback ?? null,
      },
      outcome: { error: err?.message ?? "frame failed", latency_ms: Date.now() - startedAt },
    });
  }
  return NextResponse.json(await getBrief(id));
}
