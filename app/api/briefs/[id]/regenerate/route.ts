import { NextRequest, NextResponse } from "next/server";
import { findCreator, rankPrototypes, PRODUCTS } from "@/lib/data";
import { generateStoryboard } from "@/lib/storyboard";
import { getBrief, setStoryboard, setFailed } from "@/lib/briefs";
import { isAuthed } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Regenerates the storyboard for an existing brief (new sampling from Gemini).
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!isAuthed(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const brief = await getBrief(id);
  if (!brief) return NextResponse.json({ error: "not found" }, { status: 404 });

  const creator = findCreator(brief.creator_handle);
  const product = PRODUCTS.find((p) => p.id === brief.product_id);
  if (!creator || !product) return NextResponse.json({ error: "creator or product not found" }, { status: 400 });

  try {
    const prototypes = rankPrototypes({
      creator,
      product: product.name,
      target_duration_s: brief.target_duration_s,
      limit: 3,
    });
    const sb = await generateStoryboard({
      creator,
      product_line: `${product.name} by ${product.brand} — ${product.one_liner}`,
      product_id: brief.product_id,
      prototypes,
      target_duration_s: brief.target_duration_s,
      youtube_ref: brief.youtube_ref,
    });
    await setStoryboard(brief.id, { ...sb, brief_id: brief.id });
  } catch (err: any) {
    await setFailed(brief.id, err?.message ?? "regenerate failed");
  }

  return NextResponse.json(await getBrief(brief.id));
}
