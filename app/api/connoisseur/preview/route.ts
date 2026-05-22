// GET /api/connoisseur/preview?brand_slug=<slug>
//
// Returns the full enrichment bundle (voice atoms + selling points + winners +
// gates + archetype perf) for a brand — no generation, just the data. The
// Connoisseur panel calls this when the operator opens it so they can see the
// raw corpus items and pick which to prioritize.

import { NextRequest, NextResponse } from "next/server";
import { fetchScriptEnrichment } from "@/lib/connoisseur_enrichment";
import { isAuthed } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  if (!isAuthed(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const brand_slug = req.nextUrl.searchParams.get("brand_slug") || "ashwamag";
  try {
    const enrichment = await fetchScriptEnrichment(
      { brand: brand_slug, name: brand_slug } as any,
      { limit: 30, brand_slug_override: brand_slug },
    );
    return NextResponse.json(enrichment);
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? "preview failed" }, { status: 502 });
  }
}
