// GET /api/scripts/research-brief?product_id=<id>
//
// Read-only research aggregator for the Meta direct-response script generator.
// Independent of the TikTok UGC pipeline — this brief is product-only:
// pain breakdown, consumer voice, ingredients, audience. No creators, no
// prototype videos. Meta scripts get their structural references from
// competitor ad libraries (Foreplay / Meta Ads Library), not from the
// TikTok prototype set this codebase has indexed for the UGC pipeline.

import { NextRequest, NextResponse } from "next/server";
import { findProduct, ensureProductsLoaded } from "@/lib/data";
import { isAuthed } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!isAuthed(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const product_id = req.nextUrl.searchParams.get("product_id") ?? "";
  if (!product_id) return NextResponse.json({ error: "product_id required" }, { status: 400 });

  await ensureProductsLoaded();
  const product = findProduct(product_id);
  if (!product) return NextResponse.json({ error: "product not found" }, { status: 404 });

  return NextResponse.json({
    product,
    research_brief: {
      one_liner: product.one_liner ?? "",
      brand: product.brand ?? "",
      pain_breakdown: product.pain_breakdown ?? [],
      pain_anchors: product.pain_anchors ?? [],
      consumer_quotes: product.consumer_quotes ?? [],
      key_ingredients: product.key_ingredients ?? [],
      delivery_tech: product.delivery_tech ?? null,
      format: product.format ?? null,
      price_band: product.price_band ?? null,
      audience_primary: product.audience_primary ?? null,
      audience_secondary: product.audience_secondary ?? null,
    },
    counts: {
      pain_points: (product.pain_breakdown ?? []).length,
      consumer_quotes: (product.consumer_quotes ?? []).length,
      key_ingredients: (product.key_ingredients ?? []).length,
    },
  });
}
