// GET /api/scripts/research-brief?product_id=<id>
//
// Read-only aggregator. Pulls together everything the script generator will
// eventually consume — pain breakdowns, consumer voice, top reference
// prototypes, and the creators best matched to the product's archetype — and
// returns it as a single JSON for the Scripts page to render.
//
// Zero LLM calls. Zero external API calls. Just reads existing JSON +
// Postgres-backed runtime additions. Cheap, fast, deterministic.

import { NextRequest, NextResponse } from "next/server";
import {
  findProduct,
  rankPrototypes,
  getCreators,
  ensureCreatorsLoaded,
  ensureProductsLoaded,
  type Creator,
  type Prototype,
} from "@/lib/data";
import { isAuthed } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Lifted from lib/data.ts rankPrototypes — same archetype → narrative mapping
// so the "top creators" panel matches the prototype ranking heuristic.
const ARCHETYPE_AFFINITY: Record<string, string[]> = {
  pharmacist: ["pharmacist_authority", "10_form_stack", "glycinate_vs_oxide", "liposomal_superiority"],
  health_educator: ["deficiency_mechanism", "magnesium_deficiency", "compound_synergy", "10_form_stack"],
  wellness_influencer: ["stress_sleep_connection", "magnesium_deficiency", "compound_synergy"],
  deal_hunter: ["sale_announcement", "deal_stacking_tutorial", "deal_announcement", "direct_sales_pitch"],
  product_reviewer: ["liposomal_superiority", "social_proof_flood", "10_form_stack"],
  beauty_guru: ["stress_sleep_connection", "compound_synergy"],
  esthetician: ["stress_sleep_connection", "compound_synergy"],
  grooming_influencer: ["compound_synergy", "10_form_stack"],
};

function rankCreatorsForProduct(product_id: string, limit = 8): Creator[] {
  const creators = getCreators().filter((c) => c.has_dossier);
  // Score: GMV (log-scaled) + archetype alignment to product's primary pains.
  const scored = creators.map((c) => {
    let score = 0;
    if (c.kalo_gmv) score += Math.log10(c.kalo_gmv + 1) * 10;
    if (c.energy_rating) score += c.energy_rating;
    // Light boost for archetypes we have narrative affinity data for.
    if (ARCHETYPE_AFFINITY[c.archetype]) score += 6;
    return { c, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((x) => x.c);
}

function flattenSpeechSamples(protos: Prototype[], n = 6): { video_id: string; speech: string; overlay: string }[] {
  const out: { video_id: string; speech: string; overlay: string }[] = [];
  for (const p of protos) {
    for (const s of p.shots) {
      if (out.length >= n) break;
      if (!s.speech) continue;
      out.push({ video_id: p.video_id, speech: s.speech, overlay: s.overlay });
    }
    if (out.length >= n) break;
  }
  return out;
}

export async function GET(req: NextRequest) {
  if (!isAuthed(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const product_id = req.nextUrl.searchParams.get("product_id") ?? "";
  if (!product_id) return NextResponse.json({ error: "product_id required" }, { status: 400 });

  await Promise.all([ensureProductsLoaded(), ensureCreatorsLoaded()]);

  const product = findProduct(product_id);
  if (!product) return NextResponse.json({ error: "product not found" }, { status: 404 });

  // Use the same scoring lib the storyboard generator uses, so the brief
  // surfaces the SAME prototypes the script generator will actually use.
  const prototypes = rankPrototypes({
    creator: { handle: "_top", archetype: "wellness_influencer", kalo_gmv: 0, winners: 0, top_pain: "", energy_rating: 8, dossier_excerpt: null, has_dossier: false },
    product: product.name,
    target_duration_s: 25,
    limit: 12,
  });

  const creators = rankCreatorsForProduct(product_id, 8);
  const speech_samples = flattenSpeechSamples(prototypes, 8);

  return NextResponse.json({
    product,
    research_brief: {
      pain_breakdown: product.pain_breakdown ?? [],
      consumer_quotes: product.consumer_quotes ?? [],
      pain_anchors: product.pain_anchors ?? [],
      key_ingredients: product.key_ingredients ?? [],
      audience_primary: product.audience_primary ?? null,
      audience_secondary: product.audience_secondary ?? null,
    },
    prototypes: prototypes.map((p) => ({
      video_id: p.video_id,
      narrative_direction: p.narrative_direction,
      video_format: p.video_format,
      duration_seconds: p.duration_seconds,
      funnel_stage: p.funnel_stage,
      voice_style: p.voice_style,
      shot_count: p.shots.length,
      first_shot: p.shots[0] ?? null,
    })),
    creators: creators.map((c) => ({
      handle: c.handle,
      archetype: c.archetype,
      top_pain: c.top_pain,
      kalo_gmv: c.kalo_gmv,
      energy_rating: c.energy_rating,
      dossier_excerpt: c.dossier_excerpt,
    })),
    speech_samples,
    counts: {
      prototypes: prototypes.length,
      creators: creators.length,
      pain_points: (product.pain_breakdown ?? []).length,
      consumer_quotes: (product.consumer_quotes ?? []).length,
    },
  });
}
