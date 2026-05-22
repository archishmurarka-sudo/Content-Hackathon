import { NextRequest, NextResponse } from "next/server";
import { findCreator, rankPrototypes, ensureCreatorsLoaded, ensureProductsLoaded, findProduct } from "@/lib/data";
import { generateStoryboard } from "@/lib/storyboard";
import { getBrief, setStoryboard, setFailed } from "@/lib/briefs";
import { fetchScriptEnrichment } from "@/lib/connoisseur_enrichment";
import { logEvent } from "@/lib/events";
import { isAuthed } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Regenerates the storyboard for an existing brief (new sampling from Gemini).
// Body: { enrich_with_connoisseur?: boolean } — defaults to true. The initial
// brief generation already runs through the same enrichment path; regenerate
// has to mirror it or the prompt loses the Connoisseur voice atoms / gates
// the operator was reviewing against.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!isAuthed(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const brief = await getBrief(id);
  if (!brief) return NextResponse.json({ error: "not found" }, { status: 404 });

  const body = await req.json().catch(() => ({} as any));
  const enrich = body.enrich_with_connoisseur !== false; // default ON

  await ensureCreatorsLoaded();
  await ensureProductsLoaded();
  const creator = findCreator(brief.creator_handle);
  const product = findProduct(brief.product_id);
  if (!creator || !product) return NextResponse.json({ error: "creator or product not found" }, { status: 400 });

  const previousStoryboard = brief.storyboard;
  const startedAt = Date.now();

  // Fetch enrichment in parallel with prototype ranking. Soft-fails so MCP
  // outages don't block the regenerate.
  const enrichment = enrich
    ? await fetchScriptEnrichment(product).catch(() => undefined)
    : undefined;

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
      enrichment,
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
        enriched_with_connoisseur: Boolean(enrichment),
        enrichment_counts: enrichment
          ? {
              voice_atoms: enrichment.voice_atoms.length,
              selling_points: enrichment.selling_points.length,
              winner_combos: enrichment.winner_combos.length,
              compliance_gates: enrichment.compliance_gates.length,
              archetype_performance: enrichment.archetype_performance.length,
            }
          : null,
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
      payload: { creator_handle: brief.creator_handle, product_id: brief.product_id, enriched_with_connoisseur: Boolean(enrichment) },
      outcome: { error: err?.message ?? "regenerate failed", latency_ms: Date.now() - startedAt },
    });
  }

  return NextResponse.json({
    ...(await getBrief(brief.id)),
    enrichment: enrichment
      ? {
          brand_slug: enrichment.brand_slug,
          counts: {
            voice_atoms: enrichment.voice_atoms.length,
            selling_points: enrichment.selling_points.length,
            winner_combos: enrichment.winner_combos.length,
            compliance_gates: enrichment.compliance_gates.length,
            archetype_performance: enrichment.archetype_performance.length,
          },
          tool_status: enrichment.tool_status,
        }
      : null,
  });
}
