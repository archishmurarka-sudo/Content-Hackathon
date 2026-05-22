import { NextRequest, NextResponse } from "next/server";
import { isAuthed } from "@/lib/auth";
import { generateIgPost, listIgPosts, IG_FORMATS, IG_THEMES, IG_AUDIENCES, type IgFormat } from "@/lib/instagram";
import { fetchScriptEnrichment } from "@/lib/connoisseur_enrichment";
import { ensureProductsLoaded, findProduct } from "@/lib/data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// gpt-image-2 can take up to ~60s; Gemini creative drafting another ~5–10s.
export const maxDuration = 180;

export async function GET(req: NextRequest) {
  if (!isAuthed(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json({
    posts: await listIgPosts(),
    formats: IG_FORMATS,
    themes: IG_THEMES,
    audiences: IG_AUDIENCES,
  });
}

export async function POST(req: NextRequest) {
  if (!isAuthed(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const product_id = String(body.product_id ?? "").trim();
  const theme = String(body.theme ?? "").trim();
  const format = String(body.format ?? "feed_1x1").trim() as IgFormat;
  const audience = typeof body.audience === "string" ? body.audience.trim() : "general";
  const vibe = typeof body.vibe === "string" ? body.vibe : "";
  // Operator toggle — fetch Connoisseur enrichment (voice atoms, selling
  // points, gates) and pass it through to the IG creative drafter. Default ON.
  const enrich_with_connoisseur = body.enrich_with_connoisseur !== false;

  if (!product_id) return NextResponse.json({ error: "product_id required" }, { status: 400 });
  if (!theme) return NextResponse.json({ error: "theme required" }, { status: 400 });
  if (!IG_FORMATS.some((f) => f.value === format)) {
    return NextResponse.json({ error: `unknown format '${format}'` }, { status: 400 });
  }

  if (!(process.env.OPENAI_API_KEY || process.env.OPENAI_KEY)) {
    return NextResponse.json({ error: "OPENAI_API_KEY / OPENAI_KEY not set on the server" }, { status: 500 });
  }
  if (!process.env.GEMINI_API_KEY) {
    return NextResponse.json({ error: "GEMINI_API_KEY not set on the server" }, { status: 500 });
  }

  // Pre-fetch enrichment in parallel with product hydration. Soft-fails to
  // undefined so MCP outages never block image generation.
  let enrichment: Awaited<ReturnType<typeof fetchScriptEnrichment>> | undefined;
  if (enrich_with_connoisseur) {
    await ensureProductsLoaded();
    const productForEnrich = findProduct(product_id);
    if (productForEnrich) {
      enrichment = await fetchScriptEnrichment(productForEnrich).catch(() => undefined);
    }
  }

  try {
    const post = await generateIgPost({ product_id, theme, format, audience, vibe, enrichment });
    return NextResponse.json({
      ...post,
      enrichment: enrichment ? {
        brand_slug: enrichment.brand_slug,
        counts: {
          voice_atoms: enrichment.voice_atoms.length,
          selling_points: enrichment.selling_points.length,
          winner_combos: enrichment.winner_combos.length,
          compliance_gates: enrichment.compliance_gates.length,
          archetype_performance: enrichment.archetype_performance.length,
        },
      } : null,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? "ig post generation failed" }, { status: 500 });
  }
}
