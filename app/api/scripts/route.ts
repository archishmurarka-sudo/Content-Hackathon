// GET  /api/scripts?product_id=<id>   list saved scripts for a product
// POST /api/scripts                    generate a new batch via Gemini

import { NextRequest, NextResponse } from "next/server";
import { isAuthed } from "@/lib/auth";
import { ensureProductsLoaded, findProduct } from "@/lib/data";
import { generateScripts, type ScriptStyle, type Placement } from "@/lib/script-generator";
import { insertScripts, listScriptsForProduct, newBatchId } from "@/lib/ad-scripts";
import { fetchScriptEnrichment, resolveEnrichmentFromBody } from "@/lib/connoisseur_enrichment";
import { logEvent } from "@/lib/events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const VALID_STYLES: ScriptStyle[] = ["problem_solution", "testimonial", "listicle", "founder_story", "before_after", "mixed"];
const VALID_PLACEMENTS: Placement[] = ["feed", "reels", "stories", "mixed"];

export async function GET(req: NextRequest) {
  if (!isAuthed(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const product_id = req.nextUrl.searchParams.get("product_id");
  if (!product_id) return NextResponse.json({ scripts: [] });
  const scripts = await listScriptsForProduct(product_id);
  return NextResponse.json({ scripts });
}

export async function POST(req: NextRequest) {
  if (!isAuthed(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({} as any));

  const product_id = String(body.product_id ?? "").trim();
  if (!product_id) return NextResponse.json({ error: "product_id required" }, { status: 400 });

  const count = clampInt(body.count, 1, 25, 10);
  const style: ScriptStyle = VALID_STYLES.includes(body.style) ? body.style : "mixed";
  const placement: Placement = VALID_PLACEMENTS.includes(body.placement) ? body.placement : "mixed";
  const competitor_refs = typeof body.competitor_refs === "string" ? body.competitor_refs : undefined;
  const notes = typeof body.notes === "string" ? body.notes : undefined;
  // Operator toggle — when false, skip the Connoisseur MCP fetch entirely
  // (no enrichment block in the Gemini prompt, no scripts.enriched event).
  // Defaults to true so the corpus is on by default; the UI exposes it.
  const enrich_with_connoisseur = body.enrich_with_connoisseur !== false;

  await ensureProductsLoaded();
  const product = findProduct(product_id);
  if (!product) return NextResponse.json({ error: "product not found" }, { status: 404 });

  if (!process.env.GEMINI_API_KEY) {
    return NextResponse.json({ error: "GEMINI_API_KEY not set on the server" }, { status: 500 });
  }

  // Resolve enrichment: honors the toggle, accepts an operator-picked
  // override blob from the Connoisseur panel, otherwise fetches live.
  // Soft-fails to undefined so MCP downtime never blocks generation.
  const enrichment = await resolveEnrichmentFromBody(product, body);

  try {
    const generated = await generateScripts({
      product,
      count,
      style,
      placement,
      competitor_refs,
      notes,
      enrichment,
    });
    if (generated.length === 0) {
      return NextResponse.json({ error: "Gemini returned no scripts" }, { status: 502 });
    }
    const batch_id = newBatchId();
    const saved = await insertScripts({ product_id, batch_id, scripts: generated });

    // Append-only log of what fed the batch — supports future model
    // fine-tuning and lets the operator audit the enrichment after the fact.
    if (enrichment) {
      void logEvent({
        type: "scripts.enriched",
        brief_id: batch_id,
        payload: {
          product_id,
          batch_id,
          brand_slug: enrichment.brand_slug,
          counts: {
            voice_atoms: enrichment.voice_atoms.length,
            selling_points: enrichment.selling_points.length,
            winner_combos: enrichment.winner_combos.length,
            compliance_gates: enrichment.compliance_gates.length,
            archetype_performance: enrichment.archetype_performance.length,
          },
          tool_status: enrichment.tool_status,
        },
      });
    }

    // Sanity diagnostic — what we actually fed into the model. Lets the UI
    // verify the operator's chosen style + placement + supporting fields
    // actually made it through to the prompt instead of being silently
    // discarded. Surfaces in the success toast.
    const requested = {
      style,
      placement,
      count: saved.length,
      style_matches: saved.every((s) => style === "mixed" || s.script_kind === style),
      has_competitor_refs: Boolean(competitor_refs && competitor_refs.trim()),
      has_notes: Boolean(notes && notes.trim()),
      product_signal: {
        pain_points: (product.pain_breakdown ?? []).length,
        consumer_quotes: (product.consumer_quotes ?? []).length,
        key_ingredients: (product.key_ingredients ?? []).length,
      },
    };

    return NextResponse.json({
      count: saved.length,
      batch_id,
      scripts: saved,
      requested,
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
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? "generation failed" }, { status: 502 });
  }
}

function clampInt(v: any, lo: number, hi: number, fallback: number): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(lo, Math.min(hi, Math.round(n)));
}
