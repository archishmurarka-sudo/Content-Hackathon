// Dry-run preview for an Instagram post generation request.
//
// Returns the full Gemini meta-prompt that WOULD be sent, plus the rendered
// Connoisseur enrichment block (so the operator can see exactly which voice
// atoms / selling points / gates are being injected), without burning any
// paid API calls. No Gemini, no OpenAI image gen.
//
// Body shape is identical to POST /api/instagram — same `product_id`,
// `theme`, `format`, `audience`, `vibe`, `enrich_with_connoisseur`,
// optional `enrichment_override` — so the UI can preview-then-generate by
// reusing the same form state.

import { NextRequest, NextResponse } from "next/server";
import { isAuthed } from "@/lib/auth";
import { buildIgCreativePrompt, IG_FORMATS, type IgFormat } from "@/lib/instagram";
import { resolveEnrichmentFromBody } from "@/lib/connoisseur_enrichment";
import { ensureProductsLoaded, findProduct } from "@/lib/data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  if (!isAuthed(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const product_id = String(body.product_id ?? "").trim();
  const theme = String(body.theme ?? "").trim();
  const format = String(body.format ?? "feed_1x1").trim() as IgFormat;
  const audience = typeof body.audience === "string" ? body.audience.trim() : "general";
  const vibe = typeof body.vibe === "string" ? body.vibe : "";

  if (!product_id) return NextResponse.json({ error: "product_id required" }, { status: 400 });
  if (!theme) return NextResponse.json({ error: "theme required" }, { status: 400 });
  if (!IG_FORMATS.some((f) => f.value === format)) {
    return NextResponse.json({ error: `unknown format '${format}'` }, { status: 400 });
  }

  await ensureProductsLoaded();
  const product = findProduct(product_id);
  if (!product) return NextResponse.json({ error: `unknown product '${product_id}'` }, { status: 400 });

  // Resolve enrichment via the same code path Generate uses, so the operator
  // sees the EXACT bundle that would land in the prompt. Cached + soft-fails.
  const enrichment = await resolveEnrichmentFromBody(product, body);

  const { prompt, blocks } = buildIgCreativePrompt({
    product,
    theme,
    audience,
    vibe,
    format,
    enrichment,
  });

  return NextResponse.json({
    // What gets sent to Gemini, character-for-character.
    gemini_prompt: prompt,
    // Each composable block exposed individually so the UI can highlight
    // them (and the operator can see the Connoisseur block in isolation).
    blocks,
    // Diagnostic — which corpus slug resolved, and how many items came back
    // from each Connoisseur tool. null when the toggle was off.
    enrichment_summary: enrichment ? {
      brand_slug: enrichment.brand_slug,
      counts: {
        voice_atoms: enrichment.voice_atoms.length,
        selling_points: enrichment.selling_points.length,
        winner_combos: enrichment.winner_combos.length,
        compliance_gates: enrichment.compliance_gates.length,
        archetype_performance: enrichment.archetype_performance.length,
      },
      tool_status: enrichment.tool_status,
      // The raw arrays — so the panel can render them as a table/list,
      // not just a count. The full prompt text is in `gemini_prompt` and
      // `blocks.enrichment_block` too, but those are the formatted form.
      voice_atoms: enrichment.voice_atoms,
      selling_points: enrichment.selling_points,
      winner_combos: enrichment.winner_combos,
      compliance_gates: enrichment.compliance_gates,
      archetype_performance: enrichment.archetype_performance,
    } : null,
    // Reference image diagnostics — same info Generate surfaces.
    reference: {
      hero_present: Boolean(product.hero_image_url),
      gallery_count: product.gallery_image_urls?.length ?? 0,
    },
  });
}
