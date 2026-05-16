import { NextRequest, NextResponse } from "next/server";
import { findCreator, rankPrototypes, ensureCreatorsLoaded, ensureProductsLoaded, findProduct } from "@/lib/data";
import { generateStoryboard } from "@/lib/storyboard";
import { getBrief, setStoryboard, setFailed } from "@/lib/briefs";
import { logEvent } from "@/lib/events";
import { isAuthed } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Regenerates the storyboard for an existing brief (new sampling from Gemini).
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!isAuthed(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const brief = await getBrief(id);
  if (!brief) return NextResponse.json({ error: "not found" }, { status: 404 });

  await ensureCreatorsLoaded();
  await ensureProductsLoaded();
  const creator = findCreator(brief.creator_handle);
  const product = findProduct(brief.product_id);
  if (!creator || !product) return NextResponse.json({ error: "creator or product not found" }, { status: 400 });

  const previousStoryboard = brief.storyboard;
  const startedAt = Date.now();

  try {
    const prototypes = rankPrototypes({
      creator,
      product: product.name,
      target_duration_s: brief.target_duration_s,
      limit: 3,
    });
    const sb = await generateStoryboard({
      creator,
      product,
      prototypes,
      target_duration_s: brief.target_duration_s,
      youtube_ref: brief.youtube_ref,
    });
    await setStoryboard(brief.id, { ...sb, brief_id: brief.id });
    void logEvent({
      type: "brief.regenerate_script",
      brief_id: brief.id,
      payload: {
        creator_handle: brief.creator_handle,
        product_id: brief.product_id,
        previous_hook: previousStoryboard?.hook ?? null,
        previous_cta: previousStoryboard?.cta ?? null,
        previous_inspired_by: previousStoryboard?.inspired_by_video_ids ?? null,
      },
      outcome: {
        new_hook: sb.hook,
        new_cta: sb.cta,
        new_inspired_by: sb.inspired_by_video_ids,
        latency_ms: Date.now() - startedAt,
      },
    });
  } catch (err: any) {
    await setFailed(brief.id, err?.message ?? "regenerate failed");
    void logEvent({
      type: "brief.regenerate_script",
      brief_id: brief.id,
      payload: { creator_handle: brief.creator_handle, product_id: brief.product_id },
      outcome: { error: err?.message ?? "regenerate failed", latency_ms: Date.now() - startedAt },
    });
  }

  return NextResponse.json(await getBrief(brief.id));
}
